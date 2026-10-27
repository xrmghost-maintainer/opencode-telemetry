// Run with Node after installing opencode-telemetry globally from npm.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, createScanner, findNodeAtLocation, modify, parse, parseTree, SyntaxKind } from "jsonc-parser";

export function findConfig(directory) {
  const json = join(directory, "opencode.json");
  const jsonc = join(directory, "opencode.jsonc");
  if (existsSync(json) && existsSync(jsonc)) {
    throw new Error(`Both ${json} and ${jsonc} exist. Consolidate them into one config before running this helper; neither file was changed.`);
  }
  return existsSync(jsonc) ? jsonc : json;
}

export function configureTelemetry(mode, configPath, packageDirectory) {
  if (mode !== "v1" && mode !== "v2") throw new Error("Usage: configure-plugin.js v1|v2");
  const pkg = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
  if (pkg.name !== "opencode-telemetry" || typeof pkg.version !== "string" || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(pkg.version)) {
    throw new Error("Install a stable opencode-telemetry package before configuring the plugin");
  }
  if (!existsSync(join(packageDirectory, "index.ts"))) throw new Error("Missing plugin index.ts");
  const existed = existsSync(configPath);
  let text = existed ? readFileSync(configPath, "utf8") : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
  const errors = [];
  const config = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Invalid JSON/JSONC object in ${configPath}; no changes made`);
  }
  const telemetry = (entry) => {
    const ref = Array.isArray(entry) ? entry[0] : typeof entry === "object" && entry ? entry.package : entry;
    return typeof ref === "string" && /(?:^|[/@])opencode-telemetry(?:@|\/|$)/.test(ref);
  };
  const target = mode === "v1" ? "plugin" : "plugins";
  const reference = mode === "v1" ? `opencode-telemetry@${pkg.version}` : resolve(packageDirectory);
  // Validate both arrays before making any edits or creating a backup.
  for (const key of ["plugin", "plugins"]) {
    if (config[key] !== undefined && !Array.isArray(config[key])) throw new Error(`${key} must be an array`);
  }
  let retained = false;
  for (const key of ["plugin", "plugins"]) {
    if (config[key] === undefined) continue;
    // Remove only telemetry array elements, not the entire property: this keeps
    // comments on the property and on unrelated entries intact.
    for (let i = config[key].length - 1; i >= 0; i--) {
      if (!telemetry(config[key][i])) continue;
      if (key === target && config[key][i] === reference && !retained) {
        retained = true;
        continue;
      }
      // Delete the node and its separator independently, retaining surrounding
      // trivia. jsonc-parser 3.3.1's last-element deletion truncates compact JSON.
      const array = findNodeAtLocation(parseTree(text), [key]);
      const node = array.children[i];
      const previous = array.children[i - 1];
      const scanner = createScanner(text, false);
      scanner.setPosition(previous ? previous.offset + previous.length : node.offset + node.length);
      const end = previous ? node.offset : (array.children[i + 1]?.offset ?? array.offset + array.length - 1);
      let comma;
      for (let token = scanner.scan(); scanner.getTokenOffset() < end && token !== SyntaxKind.EOF; token = scanner.scan()) {
        if (token === SyntaxKind.CommaToken) { comma = scanner.getTokenOffset(); break; }
      }
      const edits = [{ offset: node.offset, length: node.length, content: "" }];
      if (comma !== undefined) edits.push({ offset: comma, length: 1, content: "" });
      text = applyEdits(text, edits);
    }
  }
  const updated = parse(text);
  if (!retained) text = applyEdits(text, modify(text, updated[target] ? [target, -1] : [target], updated[target] ? reference : [reference], {}));
  // Comments inside a removed telemetry entry may be removed with that entry.
  // Refuse that edit instead of silently deleting the comment.
  const comments = (source) => {
    const result = [];
    const scanner = createScanner(source, false);
    for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
      if (token === SyntaxKind.LineCommentTrivia || token === SyntaxKind.BlockCommentTrivia) result.push(scanner.getTokenValue());
    }
    return result;
  };
  const remaining = comments(text);
  const removedComments = comments(existed ? readFileSync(configPath, "utf8") : "").some((comment) => {
    const index = remaining.indexOf(comment);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
  const backup = `${configPath}.before-octm-${pkg.version}`;
  if (removedComments) throw new Error(`A comment belongs to a telemetry entry that must be replaced in ${configPath}. Move that comment outside the entry and retry; no changes made.`);
  const outputErrors = [];
  parse(text, outputErrors, { allowTrailingComma: true });
  if (outputErrors.length) throw new Error(`Cannot safely edit ${configPath}; no changes made`);
  mkdirSync(dirname(configPath), { recursive: true });
  if (existed && !existsSync(backup)) copyFileSync(configPath, backup);
  writeFileSync(configPath, text);
  return reference;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim();
    const config = findConfig(join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode"));
    console.log(configureTelemetry(process.argv[2], config, join(root, "opencode-telemetry")));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
