#!/usr/bin/env node
// Keep the SQLite CLI on Bun; Node only supplies an actionable startup error.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync("bun", [fileURLToPath(new URL("./cli.js", import.meta.url)), ...process.argv.slice(2)], {
  stdio: "inherit",
});
if (result.error) {
  console.error(`[opencode-telemetry] Cannot start Bun from PATH: ${result.error.message}
Bun >=1.3.13 is required (the CLI uses bun:sqlite, not Node SQLite).
Install: curl -fsSL https://bun.sh/install | bash
Then add "$HOME/.bun/bin" to PATH and verify: bun --version
For services with a restricted PATH (e.g. systemd), configure their PATH or run:
  sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
Ensure /usr/local/bin is on the service PATH, then restart the service.`);
  process.exitCode = 1;
} else if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exitCode = result.status ?? 1;
}
