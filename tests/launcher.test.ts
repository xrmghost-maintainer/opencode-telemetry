import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tools() {
  const root = join(tmpdir(), "opencode");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "octm-launch-"));
  directories.push(dir);
  return dir;
}
const launcher = join(import.meta.dir, "../bin/launch.js");

test("npm/Node users without Bun get installation and service PATH instructions", () => {
  const result = spawnSync(Bun.which("node")!, [launcher, "report"], {
    env: { ...process.env, PATH: tools() }, encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Bun >=1.3.13 is required");
  expect(result.stderr).toContain("https://bun.sh/install");
  expect(result.stderr).toContain("PATH");
  expect(result.stderr).toContain("systemd");
  expect(result.stderr).not.toContain("/usr/bin/env:");
});

test("launcher forwards arguments, stdio and exit status to Bun without a shell", () => {
  const dir = tools();
  writeFileSync(join(dir, "bun"), '#!/bin/sh\nprintf "%s\\n" "$@"\necho diagnostic >&2\nexit 7\n', { mode: 0o755 });
  const result = spawnSync(Bun.which("node")!, [launcher, "sql", "select '$HOME';"], {
    env: { ...process.env, PATH: dir }, encoding: "utf8",
  });
  expect(result.status).toBe(7);
  expect(result.stdout.split("\n")).toEqual([join(import.meta.dir, "../bin/cli.js"), "sql", "select '$HOME';", ""]);
  expect(result.stderr).toBe("diagnostic\n");
});

test("launcher runs the real Bun CLI", () => {
  const result = spawnSync(Bun.which("node")!, [launcher, "help"], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("octm report");
});
