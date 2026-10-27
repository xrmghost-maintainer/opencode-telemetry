import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureTelemetry, findConfig } from "../scripts/configure-plugin.js";
import { parse } from "jsonc-parser";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const root = join(tmpdir(), "opencode");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "octm-config-"));
  directories.push(dir);
  const pkg = join(dir, "opencode-telemetry");
  mkdirSync(pkg);
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "opencode-telemetry", version: "0.3.0" }));
  writeFileSync(join(pkg, "index.ts"), "");
  const config = join(dir, "opencode.json");
  const original = JSON.stringify({
    plugin: ["other@1", ["opencode-telemetry@0.1.19", {}]],
    plugins: [{ package: "file:///old/opencode-telemetry", options: {} }, "another"],
    model: "openai/example",
  });
  writeFileSync(config, original);
  return { pkg, config, original };
}

test("configure npm V1 then installed-directory V2, preserving unrelated config and original backup", () => {
  const { pkg, config, original } = fixture();
  expect(configureTelemetry("v1", config, pkg)).toBe("opencode-telemetry@0.3.0");
  expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
    plugin: ["other@1", "opencode-telemetry@0.3.0"], plugins: ["another"], model: "openai/example",
  });
  configureTelemetry("v2", config, pkg);
  configureTelemetry("v2", config, pkg);
  expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
    plugin: ["other@1"], plugins: ["another", pkg], model: "openai/example",
  });
  expect(readFileSync(`${config}.before-octm-0.3.0`, "utf8")).toBe(original);
});

test("select JSON, JSONC or a new JSON; refuse both without changing either", () => {
  const { config, original } = fixture();
  const dir = join(config, "..");
  expect(findConfig(dir)).toBe(config);
  const jsonc = `${config}c`;
  writeFileSync(jsonc, "{/* keep */}");
  expect(() => findConfig(dir)).toThrow("Both");
  expect(readFileSync(config, "utf8")).toBe(original);
  expect(readFileSync(jsonc, "utf8")).toBe("{/* keep */}");
  rmSync(config);
  expect(findConfig(dir)).toBe(jsonc);
  rmSync(jsonc);
  expect(findConfig(dir)).toBe(config);
});

test("JSONC preserves line/block comments, trailing commas, URLs and unrelated entries", () => {
  const { pkg, config } = fixture();
  rmSync(config);
  const jsonc = `${config}c`;
  const original = `{
  // model preference
  "model": "https://example.test/a/*literal*/", /* keep this block */
  "plugin": ["opencode-telemetry@0.1.19",],
  "plugins": [
    // another plugin
    "other@1",
  ],
}
`;
  writeFileSync(jsonc, original);
  configureTelemetry("v2", findConfig(join(config, "..")), pkg);
  const first = readFileSync(jsonc, "utf8");
  for (const comment of ["// model preference", "/* keep this block */", "// another plugin"]) expect(first).toContain(comment);
  expect(parse(first)).toEqual({ model: "https://example.test/a/*literal*/", plugin: [], plugins: ["other@1", pkg] });
  configureTelemetry("v2", jsonc, pkg);
  expect(readFileSync(jsonc, "utf8")).toBe(first);
  expect(readFileSync(`${jsonc}.before-octm-0.3.0`, "utf8")).toBe(original);
  expect(existsSync(config)).toBe(false);
});

test("new nested config contains schema and plugin without inventing an original backup", () => {
  const { pkg, config } = fixture();
  const fresh = join(config, "..", "fresh", "opencode", "opencode.json");
  configureTelemetry("v1", fresh, pkg);
  expect(parse(readFileSync(fresh, "utf8"))).toEqual({ $schema: "https://opencode.ai/config.json", plugin: ["opencode-telemetry@0.3.0"] });
  expect(existsSync(`${fresh}.before-octm-0.3.0`)).toBe(false);
});

test("comments within replaced telemetry entries are never silently removed", () => {
  const { pkg, config } = fixture();
  const original = '{"plugins":[{"package":"opencode-telemetry@0.1.19", /* rationale */ "options":{}}]}';
  writeFileSync(config, original);
  expect(() => configureTelemetry("v2", config, pkg)).toThrow("comment");
  expect(readFileSync(config, "utf8")).toBe(original);
  expect(existsSync(`${config}.before-octm-0.3.0`)).toBe(false);
});

test("remove telemetry from first, middle, last and sole positions in compact JSON", () => {
  const { pkg, config } = fixture();
  for (const entries of [
    ["opencode-telemetry@old", "a", "b"],
    ["a", "opencode-telemetry@old", "b"],
    ["a", "b", "opencode-telemetry@old"],
    ["opencode-telemetry@old"],
    ["opencode-telemetry@old", "opencode-telemetry@older"],
  ]) {
    writeFileSync(config, JSON.stringify({ plugin: entries }));
    configureTelemetry("v2", config, pkg);
    expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({ plugin: entries.filter((x) => !x.startsWith("opencode-telemetry")), plugins: [pkg] });
  }
});

test("invalid JSONC and non-object roots remain untouched", () => {
  const { pkg, config } = fixture();
  for (const original of ['{/* unclosed', '{"plugins": [,]}', '[]', 'null', '"text"']) {
    writeFileSync(config, original);
    expect(() => configureTelemetry("v2", config, pkg)).toThrow();
    expect(readFileSync(config, "utf8")).toBe(original);
  }
});

test("Node helper CLI honors isolated XDG_CONFIG_HOME and discovers JSONC", () => {
  const { pkg, config } = fixture();
  const dir = join(config, "..");
  const tools = join(dir, "tools");
  const xdg = join(dir, "xdg");
  mkdirSync(tools);
  mkdirSync(join(xdg, "opencode"), { recursive: true });
  writeFileSync(join(tools, "npm"), `#!/bin/sh\necho '${dir}'\n`, { mode: 0o755 });
  const jsonc = join(xdg, "opencode", "opencode.jsonc");
  writeFileSync(jsonc, '{// keep\n"plugins":[],}');
  const result = spawnSync(Bun.which("node")!, [join(import.meta.dir, "../scripts/configure-plugin.js"), "v2"], {
    env: { ...process.env, XDG_CONFIG_HOME: xdg, PATH: tools }, encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe(pkg);
  expect(readFileSync(jsonc, "utf8")).toContain("// keep");
  expect(parse(readFileSync(jsonc, "utf8")).plugins).toEqual([pkg]);
});

test("installed package version drives the npm reference and backup name", () => {
  const { pkg, config, original } = fixture();
  writeFileSync(join(pkg, "package.json"), '{"name":"opencode-telemetry","version":"0.10.2"}');
  expect(configureTelemetry("v1", config, pkg)).toBe("opencode-telemetry@0.10.2");
  expect(readFileSync(`${config}.before-octm-0.10.2`, "utf8")).toBe(original);
  expect(configureTelemetry("v2", config, pkg)).toBe(pkg);
  expect(readFileSync(`${config}.before-octm-0.10.2`, "utf8")).toBe(original);
});

test("invalid mode, version, JSON or plugin array never overwrite config", () => {
  const { pkg, config, original } = fixture();
  expect(() => configureTelemetry("wrong", config, pkg)).toThrow();
  expect(readFileSync(config, "utf8")).toBe(original);
  writeFileSync(join(pkg, "package.json"), '{"name":"opencode-telemetry","version":"invalid"}');
  expect(() => configureTelemetry("v2", config, pkg)).toThrow();
  expect(readFileSync(config, "utf8")).toBe(original);
  writeFileSync(join(pkg, "package.json"), '{"name":"opencode-telemetry","version":"0.3.0"}');
  for (const invalid of ["{", '{"plugin":"not-an-array"}']) {
    writeFileSync(config, invalid);
    expect(() => configureTelemetry("v2", config, pkg)).toThrow();
    expect(readFileSync(config, "utf8")).toBe(invalid);
  }
});
