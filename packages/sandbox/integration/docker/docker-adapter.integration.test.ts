import { randomUUID } from "node:crypto";

import type Docker from "dockerode";
import { describe, expect } from "vitest";

import {
  SandboxProvider,
  SandboxResourceNotFoundError,
  SandboxRuntimeEnv,
  SandboxRuntimeEnvDefaults,
} from "../../src/index.js";
import { createDockerAdapter } from "../../src/providers/docker/index.js";
import {
  dockerAdapterIntegrationEnabled,
  dockerAdapterIntegrationSettings,
  it,
} from "./test-context.js";

const describeDockerAdapterIntegration = dockerAdapterIntegrationEnabled ? describe : describe.skip;
const START_MARKER_FILE_PATH = "/tmp/mistle-start-marker.txt";
const INJECTED_ENV_KEY = "MISTLE_SANDBOX_INJECTED_ENV";

type ContainerCommandResult = {
  exitCode: number;
  output: string;
};

function normalizeOutput(output: string): string {
  return output.replaceAll("\r\n", "\n").trimEnd();
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
  id: string;
  command: string[];
}): Promise<ContainerCommandResult> {
  const container = input.dockerClient.getContainer(input.id);
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
    throw new Error(`Container command did not report an exit code for runtime ${input.id}.`);
  }

  return {
    exitCode: inspect.ExitCode,
    output,
  };
}

async function writeSandboxFile(input: {
  dockerClient: Docker;
  id: string;
  path: string;
  fileContents: string;
}): Promise<void> {
  const command = ["sh", "-lc", `cat <<'EOF' > ${input.path}\n${input.fileContents}\nEOF`];
  const result = await runContainerCommand({
    dockerClient: input.dockerClient,
    id: input.id,
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
  id: string;
  path: string;
}): Promise<string> {
  const result = await runContainerCommand({
    dockerClient: input.dockerClient,
    id: input.id,
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
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({ image: fixture.baseImage });
      id = sandbox.id;

      expect(sandbox.provider).toBe(SandboxProvider.DOCKER);
      expect(sandbox.id).not.toBe("");

      const inspection = await fixture.adapter.inspect({ id: sandbox.id });
      expect(inspection.provider).toBe(SandboxProvider.DOCKER);
      if (inspection.provider !== SandboxProvider.DOCKER) {
        throw new Error("Expected Docker sandbox inspection result.");
      }
      expect(inspection.id).toBe(sandbox.id);
      expect(inspection.state).toBe("running");
      expect(inspection.disposition).toBe("active");
      expect(inspection.raw.Config.Image).toBe(fixture.baseImage.imageId);
      expect(inspection.raw.Config.Labels["mistle.sandbox.provider"]).toBe("docker");
      expect(inspection.raw.State.Running).toBe(true);
      expect(inspection.startedAt).not.toBeNull();

      await writeSandboxFile({
        dockerClient: fixture.dockerClient,
        id: sandbox.id,
        path: START_MARKER_FILE_PATH,
        fileContents: startMarker,
      });

      const readback = await readSandboxFile({
        dockerClient: fixture.dockerClient,
        id: sandbox.id,
        path: START_MARKER_FILE_PATH,
      });
      expect(readback).toBe(startMarker);
    } finally {
      if (id !== undefined) {
        await fixture.adapter.destroy({ id });
      }
    }
  }, 300_000);

  it("injects start env into sandbox process", async ({ fixture }) => {
    const injectedEnvValue = `mistle-docker-env-${randomUUID()}`;
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        image: fixture.baseImage,
        env: {
          [INJECTED_ENV_KEY]: injectedEnvValue,
        },
      });
      id = sandbox.id;

      const result = await runContainerCommand({
        dockerClient: fixture.dockerClient,
        id: sandbox.id,
        command: [
          "sh",
          "-lc",
          `printenv ${INJECTED_ENV_KEY} && printenv ${SandboxRuntimeEnv.LISTEN_ADDR} && printenv ${SandboxRuntimeEnv.USER}`,
        ],
      });

      expect(result.exitCode).toBe(0);
      expect(normalizeOutput(result.output)).toBe(
        [
          injectedEnvValue,
          SandboxRuntimeEnvDefaults.LISTEN_ADDR,
          SandboxRuntimeEnvDefaults.USER,
        ].join("\n"),
      );
    } finally {
      if (id !== undefined) {
        await fixture.adapter.destroy({ id });
      }
    }
  }, 300_000);

  it("removes a created container if docker start fails", async ({ fixture }) => {
    if (!dockerAdapterIntegrationSettings.enabled) {
      throw new Error("Docker integration settings are required for the start failure test.");
    }

    const failingAdapter = createDockerAdapter({
      socketPath: dockerAdapterIntegrationSettings.socketPath,
      networkName: `missing-network-${randomUUID()}`,
    });
    const listOptions = {
      all: true,
      filters: {
        label: ["mistle.sandbox.provider=docker"],
      },
    };
    const beforeIds = new Set(
      (await fixture.dockerClient.listContainers(listOptions)).map((container) => container.Id),
    );

    await expect(
      failingAdapter.start({
        image: fixture.baseImage,
      }),
    ).rejects.toBeInstanceOf(Error);

    const afterIds = new Set(
      (await fixture.dockerClient.listContainers(listOptions)).map((container) => container.Id),
    );
    expect(afterIds).toEqual(beforeIds);
  }, 300_000);

  it("stops and resumes a docker runtime with the same runtime id and filesystem state", async ({
    fixture,
  }) => {
    const marker = `mistle-docker-resume-${randomUUID()}`;
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({ image: fixture.baseImage });
      id = sandbox.id;

      await writeSandboxFile({
        dockerClient: fixture.dockerClient,
        id: sandbox.id,
        path: START_MARKER_FILE_PATH,
        fileContents: marker,
      });

      await fixture.adapter.stop({ id: sandbox.id });

      const stoppedInspection = await fixture.adapter.inspect({ id: sandbox.id });
      if (stoppedInspection.provider !== SandboxProvider.DOCKER) {
        throw new Error("Expected Docker sandbox inspection result after stop.");
      }
      expect(stoppedInspection.state).toBe("stopped");
      expect(stoppedInspection.disposition).toBe("resumable_stopped");
      expect(stoppedInspection.raw.State.Running).toBe(false);
      expect(stoppedInspection.raw.State.ExitCode).not.toBeNull();

      const resumedSandbox = await fixture.adapter.resume({
        id: sandbox.id,
      });

      expect(resumedSandbox.provider).toBe(SandboxProvider.DOCKER);
      expect(resumedSandbox.id).toBe(sandbox.id);

      const readback = await readSandboxFile({
        dockerClient: fixture.dockerClient,
        id: resumedSandbox.id,
        path: START_MARKER_FILE_PATH,
      });
      expect(readback).toBe(marker);
    } finally {
      if (id !== undefined) {
        await fixture.adapter.destroy({ id });
      }
    }
  }, 300_000);

  it("surfaces sandbox not found after destroy", async ({ fixture }) => {
    const sandbox = await fixture.adapter.start({ image: fixture.baseImage });

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
