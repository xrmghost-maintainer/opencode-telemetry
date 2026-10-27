import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureTelemetry } from "../scripts/configure-plugin.js";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "octm-config-"));
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

test("invalid mode, version, JSON or plugin array never overwrite config", () => {
  const { pkg, config, original } = fixture();
  expect(() => configureTelemetry("wrong", config, pkg)).toThrow();
  expect(readFileSync(config, "utf8")).toBe(original);
  writeFileSync(join(pkg, "package.json"), '{"name":"opencode-telemetry","version":"0.1.19"}');
  expect(() => configureTelemetry("v2", config, pkg)).toThrow();
  expect(readFileSync(config, "utf8")).toBe(original);
  writeFileSync(join(pkg, "package.json"), '{"name":"opencode-telemetry","version":"0.3.0"}');
  for (const invalid of ["{", '{"plugin":"not-an-array"}']) {
    writeFileSync(config, invalid);
    expect(() => configureTelemetry("v2", config, pkg)).toThrow();
    expect(readFileSync(config, "utf8")).toBe(invalid);
  }
});
