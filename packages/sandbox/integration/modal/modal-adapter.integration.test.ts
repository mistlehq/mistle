import { randomUUID } from "node:crypto";

import type { Sandbox as ModalSandbox } from "modal";
import { describe, expect } from "vitest";

import { SandboxImageKind, SandboxProvider } from "../../src/index.js";
import { it, modalAdapterIntegrationEnabled } from "./test-context.js";

const describeModalAdapterIntegration = modalAdapterIntegrationEnabled ? describe : describe.skip;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const SNAPSHOT_MARKER_FILE_PATH = "/tmp/mistle-snapshot-marker.txt";

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "unknown error";
  }
}

async function writeSandboxFile(
  sandbox: ModalSandbox,
  path: string,
  fileContents: string,
): Promise<void> {
  const file = await sandbox.open(path, "w");

  try {
    await file.write(textEncoder.encode(fileContents));
    await file.flush();
  } finally {
    await file.close();
  }
}

async function readSandboxFile(sandbox: ModalSandbox, path: string): Promise<string> {
  const file = await sandbox.open(path, "r");

  try {
    const contents = await file.read();
    return textDecoder.decode(contents);
  } finally {
    await file.close();
  }
}

describeModalAdapterIntegration("modal adapter integration", () => {
  it("supports full lifecycle from base and snapshot images", async ({ fixture }) => {
    const snapshotMarker = `mistle-modal-snapshot-${randomUUID()}`;
    let baseSandboxId: string | undefined;
    let snapshotSandboxId: string | undefined;
    let lifecycleError: unknown;
    let cleanupFailureMessage: string | undefined;

    try {
      const baseSandbox = await fixture.adapter.start({ image: fixture.baseImage });
      baseSandboxId = baseSandbox.sandboxId;
      expect(baseSandbox.provider).toBe(SandboxProvider.MODAL);
      expect(baseSandbox.sandboxId).not.toBe("");

      const baseSandboxForMutation = await fixture.modalClient.sandboxes.fromId(
        baseSandbox.sandboxId,
      );
      await writeSandboxFile(baseSandboxForMutation, SNAPSHOT_MARKER_FILE_PATH, snapshotMarker);
      const baseSandboxReadback = await readSandboxFile(
        baseSandboxForMutation,
        SNAPSHOT_MARKER_FILE_PATH,
      );
      expect(baseSandboxReadback).toBe(snapshotMarker);

      const snapshot = await fixture.adapter.snapshot({ sandboxId: baseSandbox.sandboxId });
      expect(snapshot.provider).toBe(SandboxProvider.MODAL);
      expect(snapshot.kind).toBe(SandboxImageKind.SNAPSHOT);
      expect(snapshot.imageId).not.toBe("");
      expect(Number.isNaN(Date.parse(snapshot.createdAt))).toBe(false);

      await fixture.adapter.stop({ sandboxId: baseSandbox.sandboxId });
      baseSandboxId = undefined;

      const snapshotSandbox = await fixture.adapter.start({ image: snapshot });
      snapshotSandboxId = snapshotSandbox.sandboxId;
      expect(snapshotSandbox.provider).toBe(SandboxProvider.MODAL);
      expect(snapshotSandbox.sandboxId).not.toBe("");

      const restoredSandbox = await fixture.modalClient.sandboxes.fromId(snapshotSandbox.sandboxId);
      const restoredSnapshotMarker = await readSandboxFile(
        restoredSandbox,
        SNAPSHOT_MARKER_FILE_PATH,
      );
      expect(restoredSnapshotMarker).toBe(snapshotMarker);
    } catch (error) {
      lifecycleError = error;
    } finally {
      const sandboxIdsToStop = [baseSandboxId, snapshotSandboxId].filter(
        (sandboxId): sandboxId is string => sandboxId !== undefined,
      );

      const stopResults = await Promise.allSettled(
        sandboxIdsToStop.map((sandboxId) => fixture.adapter.stop({ sandboxId })),
      );
      const stopFailures = stopResults
        .map((result, index) => {
          if (result.status === "rejected") {
            return `${sandboxIdsToStop[index]}: ${formatUnknownError(result.reason)}`;
          }

          return undefined;
        })
        .filter((failureMessage): failureMessage is string => failureMessage !== undefined);

      if (stopFailures.length > 0) {
        cleanupFailureMessage = `Failed to stop one or more Modal sandboxes during test teardown: ${stopFailures.join("; ")}`;
      }
    }

    if (lifecycleError !== undefined) {
      if (cleanupFailureMessage !== undefined) {
        throw new Error(
          `${cleanupFailureMessage}. Original lifecycle failure: ${formatUnknownError(lifecycleError)}`,
        );
      }

      throw lifecycleError;
    }

    if (cleanupFailureMessage !== undefined) {
      throw new Error(cleanupFailureMessage);
    }
  }, 300_000);
});
