import { randomUUID } from "node:crypto";

import { describe, expect } from "vitest";

import {
  SandboxProvider,
  SandboxResourceNotFoundError,
  SandboxRuntimeEnv,
  SandboxRuntimeEnvDefaults,
} from "../../src/index.js";
import { FreestyleClientOperationIds } from "../../src/providers/freestyle/client-errors.js";
import { freestyleAdapterIntegrationEnabled, it } from "./test-context.js";

const describeFreestyleAdapterIntegration = freestyleAdapterIntegrationEnabled
  ? describe
  : describe.skip;
const SANDBOX_STATE_FILE_PATH = "/tmp/mistle-freestyle-state.txt";
const INJECTED_ENV_KEY = "MISTLE_SANDBOX_INJECTED_ENV";

function createSandboxInstanceId(): string {
  return `sbi_${randomUUID().replaceAll("-", "")}`;
}

describeFreestyleAdapterIntegration("freestyle adapter integration", () => {
  it("starts a sandbox from the shared base image and injects env", async ({ fixture }) => {
    const injectedEnvValue = `mistle-freestyle-env-${randomUUID()}`;
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        sandboxInstanceId: createSandboxInstanceId(),
        image: fixture.baseImage,
        env: {
          [INJECTED_ENV_KEY]: injectedEnvValue,
        },
        resources: { vcpuCount: 2, memoryMb: 4096 },
      });
      id = sandbox.id;

      expect(sandbox.provider).toBe(SandboxProvider.FREESTYLE);
      expect(sandbox.id).not.toBe("");

      const inspection = await fixture.adapter.inspect({ id: sandbox.id });
      expect(inspection.provider).toBe(SandboxProvider.FREESTYLE);
      if (inspection.provider !== SandboxProvider.FREESTYLE) {
        throw new Error("Expected Freestyle sandbox inspection result.");
      }
      expect(inspection.id).toBe(sandbox.id);
      expect(inspection.state).toBe("running");
      expect(inspection.disposition).toBe("active");
      expect(inspection.raw.snapshotId).toBe(fixture.baseImage.imageId);
      expect(inspection.raw.sizing.vcpuCount).toBe(2);
      expect(inspection.raw.sizing.memSizeMib).toBe(4096);

      const result = await fixture.client.runCommand({
        vmId: sandbox.id,
        operation: FreestyleClientOperationIds.RUN_COMMAND,
        commandDescription: "Read injected environment",
        command: `printf '%s\\n%s' "$${INJECTED_ENV_KEY}" "$${SandboxRuntimeEnv.LISTEN_ADDR}"`,
      });

      expect(result.stdout).toBe(
        [injectedEnvValue, SandboxRuntimeEnvDefaults.LISTEN_ADDR].join("\n"),
      );
    } finally {
      if (id !== undefined) {
        await fixture.adapter.destroy({ id });
      }
    }
  }, 300_000);

  it("stops and resumes the same sandbox while preserving filesystem state", async ({
    fixture,
  }) => {
    const marker = `mistle-freestyle-state-${randomUUID()}`;
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        sandboxInstanceId: createSandboxInstanceId(),
        image: fixture.baseImage,
      });
      id = sandbox.id;

      await fixture.writeFile({
        vmId: sandbox.id,
        path: SANDBOX_STATE_FILE_PATH,
        contents: marker,
      });

      await fixture.adapter.stop({ id: sandbox.id });

      const stoppedInspection = await fixture.adapter.inspect({ id: sandbox.id });
      if (stoppedInspection.provider !== SandboxProvider.FREESTYLE) {
        throw new Error("Expected Freestyle sandbox inspection result after stop.");
      }
      expect(stoppedInspection.state).toBe("stopped");
      expect(stoppedInspection.disposition).toBe("resumable_stopped");

      const resumedSandbox = await fixture.adapter.resume({ id: sandbox.id });
      expect(resumedSandbox.id).toBe(sandbox.id);

      const readback = await fixture.readFile({
        vmId: resumedSandbox.id,
        path: SANDBOX_STATE_FILE_PATH,
      });

      expect(readback).toBe(marker);
    } finally {
      if (id !== undefined) {
        await fixture.adapter.destroy({ id });
      }
    }
  }, 300_000);

  it("captures a snapshot and starts a new sandbox from it", async ({ fixture }) => {
    const marker = `mistle-freestyle-snapshot-${randomUUID()}`;
    let sourceId: string | undefined;
    let restoredId: string | undefined;
    let snapshotId: string | undefined;

    try {
      const sourceSandbox = await fixture.adapter.start({
        sandboxInstanceId: createSandboxInstanceId(),
        image: fixture.baseImage,
      });
      sourceId = sourceSandbox.id;

      await fixture.writeFile({
        vmId: sourceSandbox.id,
        path: SANDBOX_STATE_FILE_PATH,
        contents: marker,
      });

      const snapshotHandle = await fixture.adapter.captureSnapshot({
        id: sourceSandbox.id,
      });
      snapshotId = snapshotHandle.imageId;

      expect(snapshotHandle.provider).toBe(SandboxProvider.FREESTYLE);
      expect(snapshotHandle.imageId).not.toBe("");

      const restoredSandbox = await fixture.adapter.start({
        sandboxInstanceId: createSandboxInstanceId(),
        image: snapshotHandle,
      });
      restoredId = restoredSandbox.id;

      const readback = await fixture.readFile({
        vmId: restoredSandbox.id,
        path: SANDBOX_STATE_FILE_PATH,
      });

      expect(readback).toBe(marker);
    } finally {
      if (sourceId !== undefined) {
        await fixture.adapter.destroy({ id: sourceId }).catch(() => undefined);
      }
      if (restoredId !== undefined) {
        await fixture.adapter.destroy({ id: restoredId }).catch(() => undefined);
      }
      if (snapshotId !== undefined) {
        await fixture.deleteSnapshot(snapshotId).catch(() => undefined);
      }
    }
  }, 300_000);

  it("surfaces sandbox not found after destroy", async ({ fixture }) => {
    const sandbox = await fixture.adapter.start({
      sandboxInstanceId: createSandboxInstanceId(),
      image: fixture.baseImage,
    });

    await fixture.adapter.destroy({ id: sandbox.id });

    await expect(fixture.adapter.inspect({ id: sandbox.id })).rejects.toBeInstanceOf(
      SandboxResourceNotFoundError,
    );
    await expect(fixture.adapter.resume({ id: sandbox.id })).rejects.toBeInstanceOf(
      SandboxResourceNotFoundError,
    );
    await expect(fixture.adapter.stop({ id: sandbox.id })).rejects.toBeInstanceOf(
      SandboxResourceNotFoundError,
    );
    await expect(fixture.adapter.destroy({ id: sandbox.id })).rejects.toBeInstanceOf(
      SandboxResourceNotFoundError,
    );
  }, 300_000);
});
