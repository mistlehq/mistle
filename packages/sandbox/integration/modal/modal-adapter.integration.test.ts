import { randomUUID } from "node:crypto";

import type { Sandbox as ModalSandbox } from "modal";
import { describe, expect } from "vitest";

import { SandboxImageKind, SandboxProvider } from "../../src/index.js";
import { it, modalAdapterIntegrationEnabled } from "./test-context.js";

const describeModalAdapterIntegration = modalAdapterIntegrationEnabled ? describe : describe.skip;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const SNAPSHOT_MARKER_FILE_PATH = "/tmp/mistle-snapshot-marker.txt";
const STDIN_MARKER_FILE_PATH = "/tmp/mistle-stdin-marker.txt";
const INJECTED_ENV_KEY = "MISTLE_SANDBOX_INJECTED_ENV";

type SandboxCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

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

async function runSandboxCommand(input: {
  sandbox: ModalSandbox;
  command: string[];
}): Promise<SandboxCommandResult> {
  const process = await input.sandbox.exec(input.command, { mode: "text" });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.wait(),
    process.stdout.readText(),
    process.stderr.readText(),
  ]);

  return {
    exitCode,
    stdout,
    stderr,
  };
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

  it("writes and closes stdin via the sandbox handle", async ({ fixture }) => {
    const stdinMarker = `mistle-modal-stdin-${randomUUID()}`;
    const stdinScript = textEncoder.encode(
      `printf '%s' '${stdinMarker}' > ${STDIN_MARKER_FILE_PATH}\nsleep 300\n`,
    );
    let sandboxId: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({ image: fixture.stdinProbeImage });
      sandboxId = sandbox.sandboxId;
      await sandbox.writeStdin({
        payload: stdinScript,
      });
      await sandbox.closeStdin();

      const startedSandbox = await fixture.modalClient.sandboxes.fromId(sandbox.sandboxId);
      const markerFromSandbox = await readSandboxFile(startedSandbox, STDIN_MARKER_FILE_PATH);
      expect(markerFromSandbox).toBe(stdinMarker);
    } finally {
      if (sandboxId !== undefined) {
        await fixture.adapter.stop({ sandboxId });
      }
    }
  }, 300_000);

  it("injects start env into sandbox process", async ({ fixture }) => {
    const injectedEnvValue = `mistle-modal-env-${randomUUID()}`;
    let sandboxId: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        image: fixture.baseImage,
        env: {
          [INJECTED_ENV_KEY]: injectedEnvValue,
        },
      });
      sandboxId = sandbox.sandboxId;

      const startedSandbox = await fixture.modalClient.sandboxes.fromId(sandbox.sandboxId);
      const commandResult = await runSandboxCommand({
        sandbox: startedSandbox,
        command: ["sh", "-lc", `printenv ${INJECTED_ENV_KEY}`],
      });
      expect(commandResult.exitCode).toBe(0);
      expect(commandResult.stdout.trimEnd()).toBe(injectedEnvValue);
    } finally {
      if (sandboxId !== undefined) {
        await fixture.adapter.stop({ sandboxId });
      }
    }
  }, 300_000);
});
