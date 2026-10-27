// Run with Node after installing opencode-telemetry globally from npm.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function configureTelemetry(mode, configPath, packageDirectory) {
  if (mode !== "v1" && mode !== "v2") throw new Error("Usage: configure-plugin.js v1|v2");
  const pkg = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
  if (pkg.name !== "opencode-telemetry" || pkg.version !== "0.3.0") {
    throw new Error("Install opencode-telemetry@0.3.0 before configuring the plugin");
  }
  if (!existsSync(join(packageDirectory, "index.ts"))) throw new Error("Missing plugin index.ts");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const telemetry = (entry) => {
    const ref = Array.isArray(entry) ? entry[0] : typeof entry === "object" && entry ? entry.package : entry;
    return typeof ref === "string" && /(?:^|[/@])opencode-telemetry(?:@|\/|$)/.test(ref);
  };
  for (const key of ["plugin", "plugins"]) {
    if (config[key] === undefined) continue;
    if (!Array.isArray(config[key])) throw new Error(`${key} must be an array`);
    config[key] = config[key].filter((entry) => !telemetry(entry));
    if (!config[key].length) delete config[key];
  }
  const key = mode === "v1" ? "plugin" : "plugins";
  const reference = mode === "v1" ? "opencode-telemetry@0.3.0" : resolve(packageDirectory);
  (config[key] ??= []).push(reference);
  const backup = `${configPath}.before-octm-0.3.0`;
  if (!existsSync(backup)) copyFileSync(configPath, backup);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return reference;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim();
    const config = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode", "opencode.json");
    console.log(configureTelemetry(process.argv[2], config, join(root, "opencode-telemetry")));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
