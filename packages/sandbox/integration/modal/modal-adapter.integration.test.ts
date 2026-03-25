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
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({ image: fixture.baseImage });
      id = sandbox.id;
      expect(sandbox.provider).toBe(SandboxProvider.MODAL);
      expect(sandbox.id).not.toBe("");

      const startedSandbox = await fixture.modalClient.sandboxes.fromId(sandbox.id);
      await writeSandboxFile(startedSandbox, START_MARKER_FILE_PATH, startMarker);
      const readback = await readSandboxFile(startedSandbox, START_MARKER_FILE_PATH);
      expect(readback).toBe(startMarker);
    } finally {
      if (id !== undefined) {
        await fixture.adapter.destroy({ id });
      }
    }
  }, 300_000);

  it("writes and closes stdin via the sandbox handle", async ({ fixture }) => {
    const stdinMarker = `mistle-modal-stdin-${randomUUID()}`;
    const stdinScript = textEncoder.encode(
      `printf '%s' '${stdinMarker}' > ${STDIN_MARKER_FILE_PATH}\nsleep 300\n`,
    );
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({ image: fixture.stdinProbeImage });
      id = sandbox.id;
      await sandbox.writeStdin({
        payload: stdinScript,
      });
      await sandbox.closeStdin();

      const startedSandbox = await fixture.modalClient.sandboxes.fromId(sandbox.id);
      const markerFromSandbox = await readSandboxFile(startedSandbox, STDIN_MARKER_FILE_PATH);
      expect(markerFromSandbox).toBe(stdinMarker);
    } finally {
      if (id !== undefined) {
        await fixture.adapter.destroy({ id });
      }
    }
  }, 300_000);

  it("injects start env into sandbox process", async ({ fixture }) => {
    const injectedEnvValue = `mistle-modal-env-${randomUUID()}`;
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        image: fixture.baseImage,
        env: {
          [INJECTED_ENV_KEY]: injectedEnvValue,
        },
      });
      id = sandbox.id;

      const startedSandbox = await fixture.modalClient.sandboxes.fromId(sandbox.id);
      const commandResult = await runSandboxCommand({
        sandbox: startedSandbox,
        command: ["sh", "-lc", `printenv ${INJECTED_ENV_KEY}`],
      });
      expect(commandResult.exitCode).toBe(0);
      expect(commandResult.stdout.trimEnd()).toBe(injectedEnvValue);
    } finally {
      if (id !== undefined) {
        await fixture.adapter.destroy({ id });
      }
    }
  }, 300_000);

  it("resumes a modal runtime by creating fresh compute from the same image", async ({
    fixture,
  }) => {
    const marker = `mistle-modal-resume-${randomUUID()}`;
    let firstRuntimeId: string | undefined;
    let resumedRuntimeId: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        image: fixture.baseImage,
      });
      firstRuntimeId = sandbox.id;

      const startedSandbox = await fixture.modalClient.sandboxes.fromId(sandbox.id);
      await writeSandboxFile(startedSandbox, START_MARKER_FILE_PATH, marker);

      await fixture.adapter.stop({ id: sandbox.id });
      firstRuntimeId = undefined;

      const resumedSandbox = await fixture.adapter.resume({
        image: fixture.baseImage,
        id: sandbox.id,
      });
      resumedRuntimeId = resumedSandbox.id;

      expect(resumedSandbox.provider).toBe(SandboxProvider.MODAL);
      expect(resumedSandbox.id).not.toBe(sandbox.id);

      const resumedModalSandbox = await fixture.modalClient.sandboxes.fromId(resumedSandbox.id);
      const commandResult = await runSandboxCommand({
        sandbox: resumedModalSandbox,
        command: ["sh", "-lc", `test ! -e ${START_MARKER_FILE_PATH}`],
      });
      expect(commandResult.exitCode).toBe(0);
    } finally {
      if (firstRuntimeId !== undefined) {
        await fixture.adapter.destroy({ id: firstRuntimeId });
      }
      if (resumedRuntimeId !== undefined) {
        await fixture.adapter.destroy({ id: resumedRuntimeId });
      }
    }
  }, 300_000);
});
