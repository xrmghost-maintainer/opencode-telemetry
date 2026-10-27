import type { Plugin } from "@opencode/plugin";
import type { Event } from "@opencode-ai/sdk";
import { initDatabase, type DbHandle } from "./db.ts";
import { createHandlers } from "./handlers.ts";
import { registerCommands } from "./commands.ts";

// Exported separately so the real subscription and hooks can be regression tested.
export async function setupV2(ctx: Plugin.Context, openDatabase = initDatabase) {
  // Some V1 loaders enumerate callable members of a dual definition.
  if (!ctx.location) return;
  let db: DbHandle | undefined;
  const controller = new AbortController();
  try {
    db = openDatabase();
    registerCommands(import.meta.dir, ctx.location.directory);
    const handlers = createHandlers(db, {
      directory: ctx.location.directory,
      worktree: ctx.location.project.canonical,
    });
    type Start = { sessionID: string; assistantMessageID: string; agent: string;
      model: { id: string; providerID: string; variant?: string }; started: number };
    const starts = new Map<string, Start>();
    const sessions = new Set<string>();
    const dispatch = (event: unknown, reportedCost?: number) =>
      handlers.onEvent({ event: event as Event, reportedCost });

    await ctx.tool.hook("execute.before", async (e) => {
      await handlers.onToolBefore({ tool: e.tool, sessionID: e.sessionID, callID: e.id }, { args: e.input });
    });
    await ctx.tool.hook("execute.after", async (e) => {
      await handlers.onToolAfter({ tool: e.tool, sessionID: e.sessionID, callID: e.id, args: e.input }, {
        title: "", output: e.status === "completed" ? e.result.content : "",
        // Never persist error bodies: they can contain input or tool output.
        metadata: e.status === "error" ? { error: "Tool execution failed" } : e.result.metadata,
      });
    });

    const task = (async () => {
      for await (const e of ctx.event.subscribe({ signal: controller.signal })) {
        try {
          // The stream is server-wide; each plugin instance owns only its location.
          if (e.location && (e.location.directory !== ctx.location.directory ||
              ("workspaceID" in e.location ? e.location.workspaceID : undefined) !== ctx.location.workspaceID)) continue;
          if (e.type === "session.created") {
            const d = e.data;
            sessions.add(d.sessionID);
            await dispatch({ type: "session.created", properties: { info: {
              id: d.sessionID, parentID: d.parentID, directory: d.location.directory,
              time: { created: e.created },
            } } });
          } else if (e.type === "session.step.started") {
            const d = e.data;
            // Resumed sessions need a row even if creation predates plugin loading.
            if (!e.location && !sessions.has(d.sessionID)) continue;
            sessions.add(d.sessionID);
            await dispatch({ type: "session.created", properties: { info: {
              id: d.sessionID, directory: e.location?.directory, time: { created: d.started },
            } } });
            starts.set(d.assistantMessageID, d);
            await dispatch({ type: "message.updated", properties: { info: {
              role: "user", sessionID: d.sessionID, agent: d.agent,
            } } });
          } else if (e.type === "session.step.ended" || e.type === "session.step.failed") {
            const d = e.data;
            const start = starts.get(d.assistantMessageID);
            starts.delete(d.assistantMessageID);
            if (!start || !d.tokens) continue;
            await dispatch({ type: "message.updated", properties: { info: {
              role: "assistant", id: d.assistantMessageID, sessionID: d.sessionID,
              modelID: start.model.id, providerID: start.model.providerID,
              mode: start.model.variant, time: { created: start.started, completed: e.created },
              tokens: d.tokens, finish: d.finish ?? "error",
            } } }, d.cost);
          } else if ((e.type === "session.idle" || e.type === "session.execution.succeeded" ||
              e.type === "session.execution.failed") && sessions.has(e.data.sessionID)) {
            await dispatch({ type: "session.idle", properties: { sessionID: e.data.sessionID } });
          }
        } catch (err) {
          console.warn("[opencode-telemetry] V2 event failed:", err);
        }
      }
    })().catch((err) => {
      if (!controller.signal.aborted) console.warn("[opencode-telemetry] V2 subscription failed:", err);
    });
    return async () => {
      controller.abort();
      await task;
      db?.close();
    };
  } catch (err) {
    controller.abort();
    db?.close();
    console.warn("[opencode-telemetry] V2 initialization failed:", err);
  }
}
