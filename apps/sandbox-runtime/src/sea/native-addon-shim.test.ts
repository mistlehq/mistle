import { chmod, copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const OriginalExecPath = process.execPath;
const CreatedDirectories: string[] = [];

afterEach(async () => {
  Object.defineProperty(process, "execPath", {
    value: OriginalExecPath,
    configurable: true,
  });

  while (CreatedDirectories.length > 0) {
    const directoryPath = CreatedDirectories.pop();
    if (directoryPath !== undefined) {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      });
    }
  }
});

async function createSeaLikeRuntimeDirectory(): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), "mistle-sandbox-sea-shim-"));
  CreatedDirectories.push(directoryPath);

  const fakeExecPath = join(directoryPath, "sandboxd");
  await copyFile(process.execPath, fakeExecPath);
  await chmod(fakeExecPath, 0o755);

  const nativeAddonDistPath = resolve(process.cwd(), "../../packages/sandbox-rs-napi/dist");
  const nativeAddonFileNames = await readdir(nativeAddonDistPath);
  const nativeAddonFileName = nativeAddonFileNames.find((fileName) => fileName.endsWith(".node"));

  if (nativeAddonFileName === undefined) {
    throw new Error("Expected a built sandbox-rs-napi native addon in dist.");
  }

  const nativeAddonPath = join(nativeAddonDistPath, nativeAddonFileName);
  await copyFile(nativeAddonPath, join(directoryPath, "index.test.node"));

  Object.defineProperty(process, "execPath", {
    value: fakeExecPath,
    configurable: true,
  });

  return directoryPath;
}

async function resolveNativeAddonPath(): Promise<string> {
  const nativeAddonDistPath = resolve(process.cwd(), "../../packages/sandbox-rs-napi/dist");
  const nativeAddonFileNames = await readdir(nativeAddonDistPath);
  const nativeAddonFileName = nativeAddonFileNames.find((fileName) => fileName.endsWith(".node"));

  if (nativeAddonFileName === undefined) {
    throw new Error("Expected a built sandbox-rs-napi native addon in dist.");
  }

  return join(nativeAddonDistPath, nativeAddonFileName);
}

describe("native addon SEA shim", () => {
  it("matches the real native addon export surface", async () => {
    await createSeaLikeRuntimeDirectory();
    const nativeAddonModulePath = await resolveNativeAddonPath();
    const nativeAddon: Record<string, unknown> = require(nativeAddonModulePath);

    const shimModulePath = require.resolve("../../scripts/sea/native-addon-shim.cjs");
    delete require.cache[shimModulePath];
    const nativeAddonShim: Record<string, unknown> = require(shimModulePath);

    expect(Object.keys(nativeAddonShim).sort()).toEqual(Object.keys(nativeAddon).sort());

    for (const exportName of Object.keys(nativeAddon)) {
      expect(typeof nativeAddonShim[exportName]).toBe(typeof nativeAddon[exportName]);
    }
  });
});
