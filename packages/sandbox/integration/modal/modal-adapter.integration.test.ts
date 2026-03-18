import { randomUUID } from "node:crypto";

import type { Sandbox as ModalSandbox } from "modal";
import { describe, expect } from "vitest";

import { SandboxProvider } from "../../src/index.js";
import { it, modalAdapterIntegrationEnabled } from "./test-context.js";

const describeModalAdapterIntegration = modalAdapterIntegrationEnabled ? describe : describe.skip;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const START_MARKER_FILE_PATH = "/tmp/mistle-start-marker.txt";
const STDIN_MARKER_FILE_PATH = "/tmp/mistle-stdin-marker.txt";
const INJECTED_ENV_KEY = "MISTLE_SANDBOX_INJECTED_ENV";
const VOLUME_MOUNT_PATH = "/mnt/mistle-volume";
const VOLUME_MARKER_FILE_PATH = `${VOLUME_MOUNT_PATH}/mistle-volume-marker.txt`;

type SandboxCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

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
  it("starts a sandbox from a base image and exposes its filesystem", async ({ fixture }) => {
    const startMarker = `mistle-modal-start-${randomUUID()}`;
    let runtimeId: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({ image: fixture.baseImage });
      runtimeId = sandbox.runtimeId;
      expect(sandbox.provider).toBe(SandboxProvider.MODAL);
      expect(sandbox.runtimeId).not.toBe("");

      const startedSandbox = await fixture.modalClient.sandboxes.fromId(sandbox.runtimeId);
      await writeSandboxFile(startedSandbox, START_MARKER_FILE_PATH, startMarker);
      const readback = await readSandboxFile(startedSandbox, START_MARKER_FILE_PATH);
      expect(readback).toBe(startMarker);
    } finally {
      if (runtimeId !== undefined) {
        await fixture.adapter.stop({ runtimeId });
      }
    }
  }, 300_000);

  it("writes and closes stdin via the sandbox handle", async ({ fixture }) => {
    const stdinMarker = `mistle-modal-stdin-${randomUUID()}`;
    const stdinScript = textEncoder.encode(
      `printf '%s' '${stdinMarker}' > ${STDIN_MARKER_FILE_PATH}\nsleep 300\n`,
    );
    let runtimeId: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({ image: fixture.stdinProbeImage });
      runtimeId = sandbox.runtimeId;
      await sandbox.writeStdin({
        payload: stdinScript,
      });
      await sandbox.closeStdin();

      const startedSandbox = await fixture.modalClient.sandboxes.fromId(sandbox.runtimeId);
      const markerFromSandbox = await readSandboxFile(startedSandbox, STDIN_MARKER_FILE_PATH);
      expect(markerFromSandbox).toBe(stdinMarker);
    } finally {
      if (runtimeId !== undefined) {
        await fixture.adapter.stop({ runtimeId });
      }
    }
  }, 300_000);

  it("injects start env into sandbox process", async ({ fixture }) => {
    const injectedEnvValue = `mistle-modal-env-${randomUUID()}`;
    let runtimeId: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        image: fixture.baseImage,
        env: {
          [INJECTED_ENV_KEY]: injectedEnvValue,
        },
      });
      runtimeId = sandbox.runtimeId;

      const startedSandbox = await fixture.modalClient.sandboxes.fromId(sandbox.runtimeId);
      const commandResult = await runSandboxCommand({
        sandbox: startedSandbox,
        command: ["sh", "-lc", `printenv ${INJECTED_ENV_KEY}`],
      });
      expect(commandResult.exitCode).toBe(0);
      expect(commandResult.stdout.trimEnd()).toBe(injectedEnvValue);
    } finally {
      if (runtimeId !== undefined) {
        await fixture.adapter.stop({ runtimeId });
      }
    }
  }, 300_000);

  it("creates and deletes a modal volume", async ({ fixture }) => {
    const volume = await fixture.adapter.createVolume({});

    expect(volume.provider).toBe(SandboxProvider.MODAL);
    expect(volume.volumeId).not.toBe("");

    await expect(
      fixture.modalClient.volumes.fromName(volume.volumeId, { createIfMissing: false }),
    ).resolves.toMatchObject({
      name: volume.volumeId,
    });

    await fixture.adapter.deleteVolume({ volumeId: volume.volumeId });

    await expect(
      fixture.modalClient.volumes.fromName(volume.volumeId, { createIfMissing: false }),
    ).rejects.toThrow();
  }, 300_000);

  it("mounts a created volume and preserves its contents across fresh runtime starts", async ({
    fixture,
  }) => {
    const marker = `mistle-modal-volume-${randomUUID()}`;
    const volume = await fixture.adapter.createVolume({});
    let firstRuntimeId: string | undefined;
    let secondRuntimeId: string | undefined;

    try {
      const firstSandbox = await fixture.adapter.start({
        image: fixture.baseImage,
        mounts: [
          {
            volume,
            mountPath: VOLUME_MOUNT_PATH,
          },
        ],
      });
      firstRuntimeId = firstSandbox.runtimeId;

      const firstStartedSandbox = await fixture.modalClient.sandboxes.fromId(
        firstSandbox.runtimeId,
      );
      await writeSandboxFile(firstStartedSandbox, VOLUME_MARKER_FILE_PATH, marker);

      await fixture.adapter.stop({ runtimeId: firstSandbox.runtimeId });
      firstRuntimeId = undefined;

      const secondSandbox = await fixture.adapter.start({
        image: fixture.baseImage,
        mounts: [
          {
            volume,
            mountPath: VOLUME_MOUNT_PATH,
          },
        ],
      });
      secondRuntimeId = secondSandbox.runtimeId;

      const secondStartedSandbox = await fixture.modalClient.sandboxes.fromId(
        secondSandbox.runtimeId,
      );
      const readback = await readSandboxFile(secondStartedSandbox, VOLUME_MARKER_FILE_PATH);
      expect(readback).toBe(marker);
    } finally {
      if (firstRuntimeId !== undefined) {
        await fixture.adapter.stop({ runtimeId: firstRuntimeId });
      }
      if (secondRuntimeId !== undefined) {
        await fixture.adapter.stop({ runtimeId: secondRuntimeId });
      }
      await fixture.adapter.deleteVolume({ volumeId: volume.volumeId });
    }
  }, 300_000);
});
