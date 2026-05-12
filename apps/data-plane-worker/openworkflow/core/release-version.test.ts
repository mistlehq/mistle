import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readServiceReleaseVersion } from "./release-version.js";

describe("service release version", () => {
  it("reads the nearest ancestor VERSION file from the service working directory", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "mistle-release-version-"));
    try {
      const serviceDirectory = join(rootDirectory, "apps", "data-plane-worker");
      mkdirSync(serviceDirectory, { recursive: true });
      writeFileSync(join(rootDirectory, "VERSION"), "1.2.3\n", "utf8");

      expect(readServiceReleaseVersion({ startDirectory: serviceDirectory })).toBe("1.2.3");
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("rejects missing VERSION files", () => {
    const serviceDirectory = mkdtempSync(join(tmpdir(), "mistle-release-version-missing-"));
    try {
      mkdirSync(serviceDirectory, { recursive: true });

      expect(() => readServiceReleaseVersion({ startDirectory: serviceDirectory })).toThrow(
        "Could not find service release VERSION file",
      );
    } finally {
      rmSync(serviceDirectory, { recursive: true, force: true });
    }
  });

  it("rejects invalid release versions", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "mistle-release-version-invalid-"));
    try {
      mkdirSync(rootDirectory, { recursive: true });
      writeFileSync(join(rootDirectory, "VERSION"), "latest\n", "utf8");

      expect(() => readServiceReleaseVersion({ startDirectory: rootDirectory })).toThrow(
        "must match x.y.z or x.y.z-alpha.n",
      );
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});
