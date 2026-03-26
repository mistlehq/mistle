import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { readRepositoryVersion } from "./repository-version.js";

const TemporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directoryPath = mkdtempSync(join(tmpdir(), "mistle-config-version-"));
  TemporaryDirectories.push(directoryPath);
  return directoryPath;
}

function createImportMetaUrl(directoryPath: string): string {
  return pathToFileURL(join(directoryPath, "index.js")).href;
}

afterEach(() => {
  for (const directoryPath of TemporaryDirectories.splice(0)) {
    rmSync(directoryPath, { recursive: true, force: true });
  }
});

describe("readRepositoryVersion", () => {
  it("reads VERSION from an ancestor directory", () => {
    const rootDirectoryPath = createTemporaryDirectory();
    const nestedDirectoryPath = join(rootDirectoryPath, "packages", "config", "dist");
    mkdirSync(nestedDirectoryPath, { recursive: true });
    writeFileSync(join(rootDirectoryPath, "VERSION"), "0.1.0\n", "utf8");

    expect(readRepositoryVersion(createImportMetaUrl(nestedDirectoryPath))).toBe("0.1.0");
  });

  it("accepts alpha and beta prerelease versions", () => {
    const rootDirectoryPath = createTemporaryDirectory();
    const nestedDirectoryPath = join(rootDirectoryPath, "apps", "control-plane-api", "dist");
    mkdirSync(nestedDirectoryPath, { recursive: true });
    writeFileSync(join(rootDirectoryPath, "VERSION"), "0.2.0-alpha.1\n", "utf8");

    expect(readRepositoryVersion(createImportMetaUrl(nestedDirectoryPath))).toBe("0.2.0-alpha.1");
  });

  it("fails when VERSION cannot be found", () => {
    const rootDirectoryPath = createTemporaryDirectory();
    const nestedDirectoryPath = join(rootDirectoryPath, "apps", "control-plane-api", "dist");
    mkdirSync(nestedDirectoryPath, { recursive: true });

    expect(() => readRepositoryVersion(createImportMetaUrl(nestedDirectoryPath))).toThrow(
      "Could not locate VERSION",
    );
  });

  it("fails when VERSION is invalid", () => {
    const rootDirectoryPath = createTemporaryDirectory();
    const nestedDirectoryPath = join(rootDirectoryPath, "apps", "data-plane-api", "dist");
    mkdirSync(nestedDirectoryPath, { recursive: true });
    writeFileSync(join(rootDirectoryPath, "VERSION"), "version-one\n", "utf8");

    expect(() => readRepositoryVersion(createImportMetaUrl(nestedDirectoryPath))).toThrow(
      "invalid version",
    );
  });
});
