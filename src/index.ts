import type { Plugin } from "@opencode-ai/plugin";
import { setupV2 } from "./v2.ts";
import { initDatabase } from "./db.ts";
import { createHandlers } from "./handlers.ts";
import { registerCommands } from "./commands.ts";

const TelemetryPlugin: Plugin = async (ctx) => {
  try {
    registerCommands(import.meta.dir, ctx.directory);
    const db = initDatabase();
    const { onEvent, onToolBefore, onToolAfter } = createHandlers(db, ctx);
    return { event: onEvent, "tool.execute.before": onToolBefore, "tool.execute.after": onToolAfter };
  } catch (err) {
    console.warn("[opencode-telemetry] initialization failed:", err);
    return {};
  }
};

// opencode loads plugins as PluginModule ({ server: Plugin }) or bare Plugin
export const server: Plugin = TelemetryPlugin;
// Object entrypoints are supported by OpenCode >=1.18.29, including 1.19.4.
// Type-only V2 SDK imports keep the V1 runtime independent of the V2 SDK.
export default { id: "opencode-telemetry", setup: setupV2, server: TelemetryPlugin };
