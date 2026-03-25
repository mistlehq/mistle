import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
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

  const nativeAddonPath = resolve(
    process.cwd(),
    "../../packages/sandbox-rs-napi/dist/index.darwin-arm64.node",
  );
  await copyFile(nativeAddonPath, join(directoryPath, "index.test.node"));

  Object.defineProperty(process, "execPath", {
    value: fakeExecPath,
    configurable: true,
  });

  return directoryPath;
}

describe("native addon SEA shim", () => {
  it("exposes the unix socket peer uid assertion used by the supervisor", async () => {
    await createSeaLikeRuntimeDirectory();

    const shimModulePath = require.resolve("../../scripts/sea/native-addon-shim.cjs");
    delete require.cache[shimModulePath];
    const nativeAddonShim = require(shimModulePath) as {
      assertUnixSocketPeerMatchesCurrentProcessUid: unknown;
    };

    expect(typeof nativeAddonShim.assertUnixSocketPeerMatchesCurrentProcessUid).toBe("function");
  });
});
