import { randomUUID } from "node:crypto";

import type Docker from "dockerode";
import { describe, expect } from "vitest";

import { SandboxProvider } from "../../src/index.js";
import { dockerAdapterIntegrationEnabled, it } from "./test-context.js";

const describeDockerAdapterIntegration = dockerAdapterIntegrationEnabled ? describe : describe.skip;
const START_MARKER_FILE_PATH = "/tmp/mistle-start-marker.txt";
const INJECTED_ENV_KEY = "MISTLE_SANDBOX_INJECTED_ENV";
const VOLUME_MOUNT_PATH = "/mnt/mistle-volume";
const VOLUME_MARKER_FILE_PATH = `${VOLUME_MOUNT_PATH}/mistle-volume-marker.txt`;

type ContainerCommandResult = {
  exitCode: number;
  output: string;
};

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
  runtimeId: string;
  command: string[];
}): Promise<ContainerCommandResult> {
  const container = input.dockerClient.getContainer(input.runtimeId);
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
      `Container command did not report an exit code for runtime ${input.runtimeId}.`,
    );
  }

  return {
    exitCode: inspect.ExitCode,
    output,
  };
}

async function writeSandboxFile(input: {
  dockerClient: Docker;
  runtimeId: string;
  path: string;
  fileContents: string;
}): Promise<void> {
  const command = ["sh", "-lc", `cat <<'EOF' > ${input.path}\n${input.fileContents}\nEOF`];
  const result = await runContainerCommand({
    dockerClient: input.dockerClient,
    runtimeId: input.runtimeId,
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
  runtimeId: string;
  path: string;
}): Promise<string> {
  const result = await runContainerCommand({
    dockerClient: input.dockerClient,
    runtimeId: input.runtimeId,
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
  it("starts a sandbox from a base image and exposes its filesystem", async ({ fixture }) => {
    const startMarker = `mistle-docker-start-${randomUUID()}`;
    let runtimeId: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({ image: fixture.baseImage });
      runtimeId = sandbox.runtimeId;

      expect(sandbox.provider).toBe(SandboxProvider.DOCKER);
      expect(sandbox.runtimeId).not.toBe("");

      await writeSandboxFile({
        dockerClient: fixture.dockerClient,
        runtimeId: sandbox.runtimeId,
        path: START_MARKER_FILE_PATH,
        fileContents: startMarker,
      });

      const readback = await readSandboxFile({
        dockerClient: fixture.dockerClient,
        runtimeId: sandbox.runtimeId,
        path: START_MARKER_FILE_PATH,
      });
      expect(readback).toBe(startMarker);
    } finally {
      if (runtimeId !== undefined) {
        await fixture.adapter.destroy({ runtimeId });
      }
    }
  }, 300_000);

  it("writes and closes stdin via the sandbox handle", async ({ fixture }) => {
    const startupToken = `mistle-startup-stdin-${randomUUID()}`;
    const startupScript = Buffer.from(
      `printf '%s' '${startupToken}' > /tmp/mistle-startup-token\nsleep 300\n`,
      "utf8",
    );
    let runtimeId: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({ image: fixture.startupStdinProbeImage });
      runtimeId = sandbox.runtimeId;
      await sandbox.writeStdin({
        payload: startupScript,
      });
      await sandbox.closeStdin();

      const tokenFromSandbox = await readSandboxFile({
        dockerClient: fixture.dockerClient,
        runtimeId: sandbox.runtimeId,
        path: "/tmp/mistle-startup-token",
      });
      expect(tokenFromSandbox).toBe(startupToken);
    } finally {
      if (runtimeId !== undefined) {
        await fixture.adapter.destroy({ runtimeId });
      }
    }
  }, 300_000);

  it("injects start env into sandbox process", async ({ fixture }) => {
    const injectedEnvValue = `mistle-docker-env-${randomUUID()}`;
    let runtimeId: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        image: fixture.baseImage,
        env: {
          [INJECTED_ENV_KEY]: injectedEnvValue,
        },
      });
      runtimeId = sandbox.runtimeId;

      const result = await runContainerCommand({
        dockerClient: fixture.dockerClient,
        runtimeId: sandbox.runtimeId,
        command: ["sh", "-lc", `printenv ${INJECTED_ENV_KEY}`],
      });

      expect(result.exitCode).toBe(0);
      expect(result.output.trimEnd()).toBe(injectedEnvValue);
    } finally {
      if (runtimeId !== undefined) {
        await fixture.adapter.destroy({ runtimeId });
      }
    }
  }, 300_000);

  it("creates and deletes a docker volume", async ({ fixture }) => {
    const volume = await fixture.adapter.createVolume({});

    expect(volume.provider).toBe(SandboxProvider.DOCKER);
    expect(volume.volumeId).not.toBe("");

    await expect(fixture.dockerClient.getVolume(volume.volumeId).inspect()).resolves.toMatchObject({
      Name: volume.volumeId,
    });

    await fixture.adapter.deleteVolume({ volumeId: volume.volumeId });

    await expect(fixture.dockerClient.getVolume(volume.volumeId).inspect()).rejects.toMatchObject({
      statusCode: 404,
    });
  }, 300_000);

  it("mounts a created volume and preserves its contents across fresh runtime starts", async ({
    fixture,
  }) => {
    const marker = `mistle-docker-volume-${randomUUID()}`;
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

      await writeSandboxFile({
        dockerClient: fixture.dockerClient,
        runtimeId: firstSandbox.runtimeId,
        path: VOLUME_MARKER_FILE_PATH,
        fileContents: marker,
      });

      await fixture.adapter.destroy({ runtimeId: firstSandbox.runtimeId });
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

      const readback = await readSandboxFile({
        dockerClient: fixture.dockerClient,
        runtimeId: secondSandbox.runtimeId,
        path: VOLUME_MARKER_FILE_PATH,
      });
      expect(readback).toBe(marker);
    } finally {
      if (firstRuntimeId !== undefined) {
        await fixture.adapter.destroy({ runtimeId: firstRuntimeId });
      }
      if (secondRuntimeId !== undefined) {
        await fixture.adapter.destroy({ runtimeId: secondRuntimeId });
      }
      await fixture.adapter.deleteVolume({ volumeId: volume.volumeId });
    }
  }, 300_000);

  it("stops and resumes a docker runtime with the same runtime id and filesystem state", async ({
    fixture,
  }) => {
    const marker = `mistle-docker-resume-${randomUUID()}`;
    let runtimeId: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({ image: fixture.baseImage });
      runtimeId = sandbox.runtimeId;

      await writeSandboxFile({
        dockerClient: fixture.dockerClient,
        runtimeId: sandbox.runtimeId,
        path: START_MARKER_FILE_PATH,
        fileContents: marker,
      });

      await fixture.adapter.stop({ runtimeId: sandbox.runtimeId });

      const resumedSandbox = await fixture.adapter.resume({
        image: fixture.baseImage,
        previousRuntimeId: sandbox.runtimeId,
      });

      expect(resumedSandbox.provider).toBe(SandboxProvider.DOCKER);
      expect(resumedSandbox.runtimeId).toBe(sandbox.runtimeId);

      const readback = await readSandboxFile({
        dockerClient: fixture.dockerClient,
        runtimeId: resumedSandbox.runtimeId,
        path: START_MARKER_FILE_PATH,
      });
      expect(readback).toBe(marker);
    } finally {
      if (runtimeId !== undefined) {
        await fixture.adapter.destroy({ runtimeId });
      }
    }
  }, 300_000);
});
