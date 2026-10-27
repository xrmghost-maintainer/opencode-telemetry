import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const stableVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const parts = (version) => version.split(".").map(BigInt);
function compare(a, b) {
  const left = parts(a), right = parts(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

export function nextVersion(packageVersion, tags) {
  if (typeof packageVersion !== "string" || !stableVersion.test(packageVersion)) {
    throw new Error("package.json version must be a stable semver (X.Y.Z)");
  }
  let latest;
  for (const tag of tags) {
    if (!tag.startsWith("v") || !stableVersion.test(tag.slice(1))) continue;
    const version = tag.slice(1);
    if (!latest || compare(version, latest) > 0) latest = version;
  }
  if (latest && compare(packageVersion, latest) > 0) return packageVersion;
  // Preserve the previous fallback: with no stable tags, bump the package patch.
  const [major, minor, patch] = parts(latest ?? packageVersion);
  return `${major}.${minor}.${patch + 1n}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const tags = execFileSync("git", ["tag"], { encoding: "utf8" }).trim().split(/\r?\n/);
  console.log(nextVersion(pkg.version, tags));
}
