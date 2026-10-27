import { describe, expect, it } from "bun:test";
import type { Plugin } from "@opencode/plugin";
import type { DbHandle } from "../src/db.ts";
import { setupV2 } from "../src/v2.ts";
import entry from "../src/index.ts";

describe("dual OpenCode entrypoint", () => {
  it("exposes independent V1 and V2 lifecycles", () => {
    expect(entry.id).toBe("opencode-telemetry");
    expect(typeof entry.setup).toBe("function");
    expect(typeof entry.server).toBe("function");
  });
});

async function exercise(events: unknown[], failInit = false) {
  const calls: Record<string, unknown[][]> = {};
  const db = new Proxy({}, { get: (_, key: string) => (...args: unknown[]) => {
    (calls[key] ??= []).push(args);
    return key === "getMaxTurnIdx" ? -1 : undefined;
  } }) as DbHandle;
  const hooks: Record<string, (event: any) => Promise<void>> = {};
  let signal: AbortSignal | undefined;
  let done!: () => void;
  const finished = new Promise<void>((resolve) => { done = resolve; });
  const ctx = {
    location: { directory: `${import.meta.dir}/../.claude/v2-test`, project: { canonical: "/canonical" } },
    tool: { hook: async (name: string, callback: typeof hooks[string]) => { hooks[name] = callback; } },
    event: { subscribe: async function* (options: { signal: AbortSignal }) {
      signal = options.signal;
      try { for (const event of events) yield event; } finally { done(); }
    } },
  } as unknown as Plugin.Context;
  const cleanup = await setupV2(ctx, () => { if (failInit) throw Error("DB unavailable"); return db; });
  if (!failInit) await finished;
  return { calls, hooks, cleanup, signal };
}

const sessionID = "ses-v2";
const assistantMessageID = "msg-v2";
const location = { directory: `${import.meta.dir}/../.claude/v2-test` };
const tokens = { input: 163, output: 5, reasoning: 0, cache: { read: 7168, write: 0 } };
const start = { type: "session.step.started", location, created: 1200, data: {
  sessionID, assistantMessageID, agent: "build", model: { id: "gpt-5.6-luna", providerID: "openai" }, started: 1000,
} };
const end = { type: "session.step.ended", location, created: 1500, data: {
  sessionID, assistantMessageID, finish: "stop", tokens, cost: 0,
} };

describe("V2 telemetry", () => {
  it("records real step shapes, resumed sessions, zero reported cost, deduplication and completion", async () => {
    const r = await exercise([start, end, end, { type: "session.execution.succeeded", data: { sessionID } }]);
    expect(r.calls.insertTurn).toHaveLength(1);
    expect(r.calls.insertTurn[0][0]).toMatchObject({ session_id: sessionID, message_id: assistantMessageID,
      agent: "build", model: "gpt-5.6-luna", input_tokens: 163, cached_read_tokens: 7168, latency_ms: 500 });
    expect(r.calls.incrementSessionTurns[0]).toEqual([sessionID, 0, 163, 5, 7168, 0, 0]);
    expect(r.calls.finalizeSession[0]).toEqual([sessionID]);
    await r.cleanup?.();
    expect(r.signal?.aborted).toBe(true);
    expect(r.calls.close).toHaveLength(1);
  });

  it("ignores other locations and workspaces on the server-wide stream", async () => {
    const r = await exercise([
      { ...start, location: { directory: "/other" } }, end,
      { ...start, location: { ...location, workspaceID: "other" } }, end,
      { type: "session.execution.succeeded", data: { sessionID: "foreign" } },
    ]);
    expect(r.calls.insertTurn).toBeUndefined();
    expect(r.calls.finalizeSession).toBeUndefined();
    await r.cleanup?.();
  });

  it("preserves parent/location and nonzero cost on failed steps with usage", async () => {
    const r = await exercise([
      { type: "session.created", location, created: 500, data: { sessionID, parentID: "parent", location } },
      start, { ...end, type: "session.step.failed", data: { ...end.data, cost: 0.125, finish: undefined } },
    ]);
    expect(r.calls.upsertSession[0][0]).toMatchObject({ parent_session_id: "parent", project_path: location.directory });
    expect(r.calls.incrementSessionTurns[0][1]).toBe(0.125);
    expect(r.calls.insertTurn[0][0]).toMatchObject({ finish_reason: "error" });
    await r.cleanup?.();
  });

  it("maps tool IDs, structured results and errors without storing bodies", async () => {
    const r = await exercise([start]);
    const tool = { tool: "skill", id: "call-1", sessionID, input: { name: "test-skill" } };
    await r.hooks["execute.before"](tool);
    await r.hooks["execute.after"]({ ...tool, status: "completed", result: { content: [{ type: "text", text: "private" }] } });
    await r.hooks["execute.after"]({ ...tool, id: "call-2", status: "error", error: { message: "secret input" } });
    expect(r.calls.insertToolCall[0][0]).toMatchObject({ tool_call_id: "call-1", skill_name: "test-skill", status: "ok" });
    expect(r.calls.insertToolCall[1][0]).toMatchObject({ tool_call_id: "call-2", status: "error", error_message: "Tool execution failed" });
    expect(JSON.stringify(r.calls)).not.toContain("private");
    expect(JSON.stringify(r.calls)).not.toContain("secret input");
    await r.cleanup?.();
  });

  it("does not throw on database initialization failure", async () => {
    const r = await exercise([], true);
    expect(r.cleanup).toBeUndefined();
  });
});
