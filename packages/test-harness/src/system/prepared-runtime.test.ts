import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DefaultSandboxBaseImageBuild,
  readPreparedTestHarnessRuntime,
  writePreparedTestHarnessRuntime,
} from "./prepared-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { force: true, recursive: true });
    }),
  );
});

describe("DefaultSandboxBaseImageBuild", () => {
  it("points the prepared sandbox base image at the sandboxd system-test docker target", () => {
    expect(DefaultSandboxBaseImageBuild.dockerfilePath).toBe("packages/sandboxd/Dockerfile");
    expect(DefaultSandboxBaseImageBuild.dockerTarget).toBe("sandbox-base-system-tests");
  });
});

describe("prepared runtime manifest", () => {
  it("round-trips the sandboxd build fingerprint fields", async () => {
    const buildContextHostPath = await mkdtemp(join(tmpdir(), "mistle-prepared-runtime-"));
    temporaryDirectories.push(buildContextHostPath);

    await writePreparedTestHarnessRuntime({
      buildContextHostPath,
      runtime: {
        schemaVersion: 3,
        provider: "docker",
        fingerprint: {
          architecture: "x64",
          dockerContextFingerprint: "docker-fingerprint",
          sandboxdContextFingerprint: "sandboxd-fingerprint",
          sandboxBaseImageFingerprint: "sandbox-base-fingerprint",
          appImageFingerprints: {
            controlPlaneApi: "control-plane-api-image",
            controlPlaneWorker: "control-plane-worker-image",
            dataPlaneApi: "data-plane-api-image",
            dataPlaneGateway: "data-plane-gateway-image",
            dataPlaneWorker: "data-plane-worker-image",
            tokenizerProxy: "tokenizer-proxy-image",
          },
        },
        sandboxBaseImage: {
          localReference: "mistle/sandbox-base:dev",
          repositoryPath: "mistle/sandbox-base",
        },
        appImages: {
          controlPlaneApi: "mistle-test-control-plane-api",
          controlPlaneWorker: "mistle-test-control-plane-worker",
          dataPlaneApi: "mistle-test-data-plane-api",
          dataPlaneGateway: "mistle-test-data-plane-gateway",
          dataPlaneWorker: "mistle-test-data-plane-worker",
          tokenizerProxy: "mistle-test-tokenizer-proxy",
        },
      },
    });

    await expect(readPreparedTestHarnessRuntime(buildContextHostPath)).resolves.toEqual({
      schemaVersion: 3,
      provider: "docker",
      fingerprint: {
        architecture: "x64",
        dockerContextFingerprint: "docker-fingerprint",
        sandboxdContextFingerprint: "sandboxd-fingerprint",
        sandboxBaseImageFingerprint: "sandbox-base-fingerprint",
        appImageFingerprints: {
          controlPlaneApi: "control-plane-api-image",
          controlPlaneWorker: "control-plane-worker-image",
          dataPlaneApi: "data-plane-api-image",
          dataPlaneGateway: "data-plane-gateway-image",
          dataPlaneWorker: "data-plane-worker-image",
          tokenizerProxy: "tokenizer-proxy-image",
        },
      },
      sandboxBaseImage: {
        localReference: "mistle/sandbox-base:dev",
        repositoryPath: "mistle/sandbox-base",
      },
      appImages: {
        controlPlaneApi: "mistle-test-control-plane-api",
        controlPlaneWorker: "mistle-test-control-plane-worker",
        dataPlaneApi: "mistle-test-data-plane-api",
        dataPlaneGateway: "mistle-test-data-plane-gateway",
        dataPlaneWorker: "mistle-test-data-plane-worker",
        tokenizerProxy: "mistle-test-tokenizer-proxy",
      },
    });
  });
});
