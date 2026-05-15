import { randomUUID } from "node:crypto";

import { describe, expect } from "vitest";

import {
  SandboxInspectDispositions,
  SandboxInspectStates,
  SandboxProvider,
  parseTensorlakeImageHandle,
} from "../../src/index.js";
import { tensorlakeAdapterIntegrationEnabled, it } from "./test-context.js";

const describeTensorlakeAdapterIntegration = tensorlakeAdapterIntegrationEnabled
  ? describe
  : describe.skip;
const SANDBOX_STATE_FILE_PATH = "/root/mistle-tensorlake-state.txt";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function createSandboxInstanceId(): string {
  return `sbi_${randomUUID().replaceAll("-", "")}`;
}

describeTensorlakeAdapterIntegration("tensorlake adapter integration", () => {
  it("starts a sandbox from the shared base image", async ({ fixture }) => {
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        sandboxInstanceId: createSandboxInstanceId(),
        image: fixture.baseImage,
        resources: { vcpuCount: 2, memoryMb: 4096 },
      });
      id = sandbox.id;

      expect(sandbox.provider).toBe(SandboxProvider.TENSORLAKE);
      expect(sandbox.id).not.toBe("");

      const inspection = await fixture.adapter.inspect({ id: sandbox.id });
      expect(inspection.provider).toBe(SandboxProvider.TENSORLAKE);
      if (inspection.provider !== SandboxProvider.TENSORLAKE) {
        throw new Error("Expected Tensorlake sandbox inspection result.");
      }
      expect(inspection.id).toBe(sandbox.id);
      expect(inspection.state).toBe("running");
      expect(inspection.disposition).toBe("active");
      expect(inspection.raw.image).toBe(parseTensorlakeImageHandle(fixture.baseImage).id);
      expect(inspection.raw.resources.cpus).toBe(2);
      expect(inspection.raw.resources.memoryMb).toBe(4096);
    } finally {
      if (id !== undefined) {
        await fixture.adapter.destroy({ id });
      }
    }
  }, 300_000);

  it("stops and resumes the same sandbox while preserving filesystem state", async ({
    fixture,
  }) => {
    const marker = `mistle-tensorlake-state-${randomUUID()}`;
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        sandboxInstanceId: createSandboxInstanceId(),
        image: fixture.baseImage,
      });
      id = sandbox.id;

      const startedSandbox = await fixture.connectSandbox(sandbox.id);
      await startedSandbox.writeFile(SANDBOX_STATE_FILE_PATH, textEncoder.encode(marker));

      await fixture.adapter.stop({ id: sandbox.id });

      const stoppedInspection = await fixture.adapter.inspect({ id: sandbox.id });
      if (stoppedInspection.provider !== SandboxProvider.TENSORLAKE) {
        throw new Error("Expected Tensorlake sandbox inspection result after stop.");
      }
      expect(stoppedInspection.state).toBe("stopped");
      expect(stoppedInspection.disposition).toBe("resumable_stopped");

      const resumedSandbox = await fixture.adapter.resume({ id: sandbox.id });
      expect(resumedSandbox.id).toBe(sandbox.id);

      const connectedResumedSandbox = await fixture.connectSandbox(resumedSandbox.id);
      const readback = await connectedResumedSandbox.readFile(SANDBOX_STATE_FILE_PATH);

      expect(textDecoder.decode(readback)).toBe(marker);

      await fixture.adapter.destroy({ id: sandbox.id });
      expect(await fixture.listSnapshotIdsForSandbox(sandbox.id)).toEqual([]);
      id = undefined;
    } finally {
      if (id !== undefined) {
        await fixture.adapter.destroy({ id });
      }
    }
  }, 300_000);

  it("captures a snapshot and starts a new sandbox from it", async ({ fixture }) => {
    const marker = `mistle-tensorlake-snapshot-${randomUUID()}`;
    let sourceId: string | undefined;
    let restoredId: string | undefined;
    let snapshotId: string | undefined;

    try {
      const sourceSandbox = await fixture.adapter.start({
        sandboxInstanceId: createSandboxInstanceId(),
        image: fixture.baseImage,
      });
      sourceId = sourceSandbox.id;

      const connectedSourceSandbox = await fixture.connectSandbox(sourceSandbox.id);
      await connectedSourceSandbox.writeFile(SANDBOX_STATE_FILE_PATH, textEncoder.encode(marker));

      const snapshotHandle = await fixture.adapter.captureSnapshot({ id: sourceSandbox.id });
      snapshotId = parseTensorlakeImageHandle(snapshotHandle).id;

      expect(snapshotHandle.provider).toBe(SandboxProvider.TENSORLAKE);
      expect(snapshotId).not.toBe("");

      const restoredSandbox = await fixture.adapter.start({
        sandboxInstanceId: createSandboxInstanceId(),
        image: snapshotHandle,
      });
      restoredId = restoredSandbox.id;

      const connectedRestoredSandbox = await fixture.connectSandbox(restoredSandbox.id);
      const readback = await connectedRestoredSandbox.readFile(SANDBOX_STATE_FILE_PATH);

      expect(textDecoder.decode(readback)).toBe(marker);
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

  it("reports terminal state after destroy", async ({ fixture }) => {
    const sandbox = await fixture.adapter.start({
      sandboxInstanceId: createSandboxInstanceId(),
      image: fixture.baseImage,
    });

    await fixture.adapter.destroy({ id: sandbox.id });

    const inspection = await fixture.adapter.inspect({ id: sandbox.id });
    expect(inspection.provider).toBe(SandboxProvider.TENSORLAKE);
    expect(inspection.id).toBe(sandbox.id);
    expect(inspection.state).toBe(SandboxInspectStates.STOPPED);
    expect(inspection.disposition).toBe(SandboxInspectDispositions.TERMINAL_STOPPED);
    expect(await fixture.listSnapshotIdsForSandbox(sandbox.id)).toEqual([]);
  }, 300_000);
});
