import { expect, test } from "bun:test";
import { nextVersion } from "../scripts/next-version.js";

test("package above latest tag selects the package version", () => {
  expect(nextVersion("0.3.0", ["v0.1.19"])).toBe("0.3.0");
  expect(nextVersion("0.10.0", ["v0.9.9"])).toBe("0.10.0");
  expect(nextVersion("1.0.0", ["v0.99.99"])).toBe("1.0.0");
});

test("package equal to latest tag increments the tag patch", () => {
  expect(nextVersion("0.3.0", ["v0.3.0"])).toBe("0.3.1");
});

test("package below latest tag increments the numerically greatest tag", () => {
  expect(nextVersion("0.3.0", ["v0.9.9", "v0.10.0", "v0.2.99"])).toBe("0.10.1");
  expect(nextVersion("0.3.0", ["v1.0.0", "v0.99.99"])).toBe("1.0.1");
});

test("no tags preserves the package patch increment fallback", () => {
  expect(nextVersion("0.3.0", [])).toBe("0.3.1");
});

test("prerelease and non-semver tags are ignored", () => {
  expect(nextVersion("0.3.0", ["v0.1.19", "v9.0.0-rc.1", "v2.0.0+build", "other", "9.0.0"])).toBe("0.3.0");
  expect(nextVersion("0.3.0", ["v9.0.0-rc.1"])).toBe("0.3.1");
});

test("invalid or prerelease package versions fail rather than publish a malformed version", () => {
  for (const version of ["invalid", "0.3.0-rc.1", "01.2.3", "1.2"]) {
    expect(() => nextVersion(version, [])).toThrow();
  }
});
