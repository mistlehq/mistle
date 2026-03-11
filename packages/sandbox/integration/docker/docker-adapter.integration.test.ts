import { randomUUID } from "node:crypto";

import type Docker from "dockerode";
import { describe, expect } from "vitest";

import { SandboxImageKind, SandboxProvider } from "../../src/index.js";
import { dockerAdapterIntegrationEnabled, it } from "./test-context.js";

const describeDockerAdapterIntegration = dockerAdapterIntegrationEnabled ? describe : describe.skip;
const SNAPSHOT_MARKER_FILE_PATH = "/tmp/mistle-snapshot-marker.txt";
const INJECTED_ENV_KEY = "MISTLE_SANDBOX_INJECTED_ENV";
const HostDockerInternalName = "host.docker.internal";

type ContainerCommandResult = {
  exitCode: number;
  output: string;
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

function chunkToUtf8String(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (Buffer.isBuffer(chunk)) {
    return chunk.toString("utf8");
  }

  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk).toString("utf8");
  }

  throw new Error("Container stream yielded a non-text chunk.");
}

async function readUtf8Stream(stream: NodeJS.ReadableStream): Promise<string> {
  let output = "";

  for await (const chunk of stream) {
    output += chunkToUtf8String(chunk);
  }

  return output;
}

async function runContainerCommand(input: {
  dockerClient: Docker;
  sandboxId: string;
  command: string[];
}): Promise<ContainerCommandResult> {
  const container = input.dockerClient.getContainer(input.sandboxId);
  const exec = await container.exec({
    AttachStdout: true,
    AttachStderr: true,
    Cmd: input.command,
    Tty: true,
  });
  const outputStream = await exec.start({
    Detach: false,
    Tty: true,
  });
  const output = await readUtf8Stream(outputStream);
  const inspect = await exec.inspect();

  if (inspect.ExitCode === null) {
    throw new Error(
      `Container command did not report an exit code for sandbox ${input.sandboxId}.`,
    );
  }

  return {
    exitCode: inspect.ExitCode,
    output,
  };
}

async function writeSandboxFile(input: {
  dockerClient: Docker;
  sandboxId: string;
  path: string;
  fileContents: string;
}): Promise<void> {
  const command = ["sh", "-lc", `cat <<'EOF' > ${input.path}\n${input.fileContents}\nEOF`];
  const result = await runContainerCommand({
    dockerClient: input.dockerClient,
    sandboxId: input.sandboxId,
    command,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to write sandbox file at ${input.path}. Exit code ${result.exitCode}. Output: ${result.output}`,
    );
  }
}

async function readSandboxFile(input: {
  dockerClient: Docker;
  sandboxId: string;
  path: string;
}): Promise<string> {
  const result = await runContainerCommand({
    dockerClient: input.dockerClient,
    sandboxId: input.sandboxId,
    command: ["cat", input.path],
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to read sandbox file at ${input.path}. Exit code ${result.exitCode}. Output: ${result.output}`,
    );
  }

  return result.output.trimEnd();
}

describeDockerAdapterIntegration("docker adapter integration", () => {
  it("supports full lifecycle from base and snapshot images", async ({ fixture }) => {
    const snapshotMarker = `mistle-docker-snapshot-${randomUUID()}`;
    let baseSandboxId: string | undefined;
    let snapshotSandboxId: string | undefined;
    let lifecycleError: unknown;
    let cleanupFailureMessage: string | undefined;

    try {
      const baseSandbox = await fixture.adapter.start({ image: fixture.baseImage });
      baseSandboxId = baseSandbox.sandboxId;

      expect(baseSandbox.provider).toBe(SandboxProvider.DOCKER);
      expect(baseSandbox.sandboxId).not.toBe("");

      await writeSandboxFile({
        dockerClient: fixture.dockerClient,
        sandboxId: baseSandbox.sandboxId,
        path: SNAPSHOT_MARKER_FILE_PATH,
        fileContents: snapshotMarker,
      });

      const baseSandboxReadback = await readSandboxFile({
        dockerClient: fixture.dockerClient,
        sandboxId: baseSandbox.sandboxId,
        path: SNAPSHOT_MARKER_FILE_PATH,
      });
      expect(baseSandboxReadback).toBe(snapshotMarker);

      const snapshot = await fixture.adapter.snapshot({ sandboxId: baseSandbox.sandboxId });
      expect(snapshot.provider).toBe(SandboxProvider.DOCKER);
      expect(snapshot.kind).toBe(SandboxImageKind.SNAPSHOT);
      expect(snapshot.imageId).toContain(`${fixture.snapshotRepository}@sha256:`);
      expect(Number.isNaN(Date.parse(snapshot.createdAt))).toBe(false);

      await fixture.adapter.stop({ sandboxId: baseSandbox.sandboxId });
      baseSandboxId = undefined;

      const snapshotSandbox = await fixture.adapter.start({ image: snapshot });
      snapshotSandboxId = snapshotSandbox.sandboxId;
      expect(snapshotSandbox.provider).toBe(SandboxProvider.DOCKER);
      expect(snapshotSandbox.sandboxId).not.toBe("");

      const restoredSnapshotMarker = await readSandboxFile({
        dockerClient: fixture.dockerClient,
        sandboxId: snapshotSandbox.sandboxId,
        path: SNAPSHOT_MARKER_FILE_PATH,
      });
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
        cleanupFailureMessage = `Failed to stop one or more Docker sandboxes during test teardown: ${stopFailures.join("; ")}`;
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
    const startupToken = `mistle-startup-stdin-${randomUUID()}`;
    const startupScript = Buffer.from(
      `printf '%s' '${startupToken}' > /tmp/mistle-startup-token\nsleep 300\n`,
      "utf8",
    );
    let sandboxId: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({ image: fixture.startupStdinProbeImage });
      sandboxId = sandbox.sandboxId;
      await sandbox.writeStdin({
        payload: startupScript,
      });
      await sandbox.closeStdin();

      const tokenFromSandbox = await readSandboxFile({
        dockerClient: fixture.dockerClient,
        sandboxId: sandbox.sandboxId,
        path: "/tmp/mistle-startup-token",
      });
      expect(tokenFromSandbox).toBe(startupToken);
    } finally {
      if (sandboxId !== undefined) {
        await fixture.adapter.stop({ sandboxId });
      }
    }
  }, 300_000);

  it("injects start env into sandbox process", async ({ fixture }) => {
    const injectedEnvValue = `mistle-docker-env-${randomUUID()}`;
    let sandboxId: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        image: fixture.baseImage,
        env: {
          [INJECTED_ENV_KEY]: injectedEnvValue,
        },
      });
      sandboxId = sandbox.sandboxId;

      const result = await runContainerCommand({
        dockerClient: fixture.dockerClient,
        sandboxId: sandbox.sandboxId,
        command: ["sh", "-lc", `printenv ${INJECTED_ENV_KEY}`],
      });

      expect(result.exitCode).toBe(0);
      expect(result.output.trimEnd()).toBe(injectedEnvValue);
    } finally {
      if (sandboxId !== undefined) {
        await fixture.adapter.stop({ sandboxId });
      }
    }
  }, 300_000);

  it("configures host gateway aliases inside docker sandboxes", async ({ fixture }) => {
    let sandboxId: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({ image: fixture.baseImage });
      sandboxId = sandbox.sandboxId;

      const result = await runContainerCommand({
        dockerClient: fixture.dockerClient,
        sandboxId: sandbox.sandboxId,
        command: ["getent", "hosts", HostDockerInternalName],
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain(HostDockerInternalName);
    } finally {
      if (sandboxId !== undefined) {
        await fixture.adapter.stop({ sandboxId });
      }
    }
  }, 300_000);
});
