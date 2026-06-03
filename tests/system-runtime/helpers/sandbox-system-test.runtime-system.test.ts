import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CodexRuntimeSandboxProviders,
  createProviderSystemTestInput,
  type CreateSandboxSystemTestInput,
} from "./sandbox-system-test.js";

const RepoRoot = path.resolve(import.meta.dirname, "../../..");
const SystemTestSearchRoots = [
  path.join(RepoRoot, "tests/system"),
  path.join(RepoRoot, "tests/system-runtime"),
];
const SearchableExtensions = new Set([".ts", ".tsx", ".js", ".json", ".md"]);
const RemovedSandboxdLifecycleReferences = [
  ["sandboxd ", "init"].join(""),
  ["sandboxd ", "wait-init"].join(""),
  ["sandboxd ", "resume"].join(""),
  ["/run/mistle/", "init.log"].join(""),
  ["/run/mistle/", "resume.log"].join(""),
];
const CurrentFilePath = filePathFromImportMetaUrl(import.meta.url);

describe("createProviderSystemTestInput", () => {
  it("preserves Cloudflare public access for each sandbox provider variant", () => {
    const input = {
      extraInfra: ["mailpit"],
      sandboxProviders: CodexRuntimeSandboxProviders,
      publicAccess: {
        provider: "cloudflare",
        services: ["data-plane-gateway"],
      },
    } satisfies CreateSandboxSystemTestInput;

    expect(createProviderSystemTestInput(input, "docker").publicAccess).toEqual(input.publicAccess);
    expect(createProviderSystemTestInput(input, "e2b").publicAccess).toEqual(input.publicAccess);
    expect(createProviderSystemTestInput(input, "tensorlake").publicAccess).toEqual(
      input.publicAccess,
    );
  });
});

describe("system activation lifecycle contract", () => {
  it("does not reference removed sandboxd lifecycle commands or logs", () => {
    const matches = [];

    for (const filePath of listSearchableFiles(SystemTestSearchRoots)) {
      if (filePath === CurrentFilePath) {
        continue;
      }

      const content = readFileSync(filePath, "utf8");
      for (const reference of RemovedSandboxdLifecycleReferences) {
        if (content.includes(reference)) {
          matches.push(`${path.relative(RepoRoot, filePath)} contains '${reference}'`);
        }
      }
    }

    expect(matches).toEqual([]);
  });
});

function listSearchableFiles(roots: readonly string[]): string[] {
  return roots.flatMap((root) => listSearchableFilesInDirectory(root));
}

function listSearchableFilesInDirectory(directoryPath: string): string[] {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      return listSearchableFilesInDirectory(entryPath);
    }
    if (entry.isFile() && SearchableExtensions.has(path.extname(entry.name))) {
      return [entryPath];
    }
    return [];
  });
}

function filePathFromImportMetaUrl(importMetaUrl: string): string {
  if (!importMetaUrl.startsWith("file://")) {
    throw new Error(`Expected file import meta url, got '${importMetaUrl}'.`);
  }
  return decodeURIComponent(new URL(importMetaUrl).pathname);
}
