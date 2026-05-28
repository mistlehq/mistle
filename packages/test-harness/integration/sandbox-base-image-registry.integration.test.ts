import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DefaultSandboxBaseImageBuild } from "../src/system/prepared-runtime.js";
import {
  readRegistryImageManifestExists,
  startSandboxBaseImageRegistry,
} from "../src/system/sandbox-base-image-registry.js";
import { MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REGISTRY_STORAGE_DIR_ENV } from "../src/system/system-test-sandbox-base-image-source.js";

const SourceImageRef = "registry:3";
const SandboxBaseImageRegistryTag = "dev";

describe("sandbox base image registry", () => {
  const cleanupTasks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    const tasks = cleanupTasks.splice(0).reverse();
    for (const task of tasks) {
      await task();
    }
  });

  it("reuses a persisted registry image on the next start with the same storage directory", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mistle-sandbox-registry-cache-"));
    cleanupTasks.push(() =>
      rm(storageDir, {
        force: true,
        recursive: true,
      }),
    );

    const env = {
      [MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REGISTRY_STORAGE_DIR_ENV]: storageDir,
    };

    const coldTimings = new Map<string, number>();
    const coldRegistry = await startSandboxBaseImageRegistry({
      sourceImageRef: SourceImageRef,
      pullSourceImage: false,
      timings: coldTimings,
      env,
    });
    cleanupTasks.push(coldRegistry.stop);

    expect(coldTimings.has("registry-image-cache-miss")).toBe(true);
    expect(coldTimings.has("registry-image-cache-hit")).toBe(false);
    expect(coldTimings.has("tag-source-image")).toBe(true);
    expect(coldTimings.has("push-registry-image")).toBe(true);
    await expectRegistryImageManifestExists(coldRegistry.endpoints.http?.hostBaseUrl);

    await coldRegistry.stop();
    cleanupTasks.pop();

    const warmTimings = new Map<string, number>();
    const warmRegistry = await startSandboxBaseImageRegistry({
      sourceImageRef: SourceImageRef,
      pullSourceImage: false,
      timings: warmTimings,
      env,
    });
    cleanupTasks.push(warmRegistry.stop);

    expect(warmTimings.has("registry-image-cache-hit")).toBe(true);
    expect(warmTimings.has("registry-image-cache-miss")).toBe(false);
    expect(warmTimings.has("tag-source-image")).toBe(false);
    expect(warmTimings.has("push-registry-image")).toBe(false);
    await expectRegistryImageManifestExists(warmRegistry.endpoints.http?.hostBaseUrl);
  }, 120_000);
});

async function expectRegistryImageManifestExists(hostBaseUrl: string | undefined): Promise<void> {
  if (hostBaseUrl === undefined) {
    throw new Error("Sandbox base image registry did not expose an HTTP endpoint.");
  }

  const manifestExists = await readRegistryImageManifestExists({
    registryBaseUrl: hostBaseUrl,
    repositoryPath: DefaultSandboxBaseImageBuild.repositoryPath,
    tag: SandboxBaseImageRegistryTag,
  });
  expect(manifestExists).toBe(true);
}
