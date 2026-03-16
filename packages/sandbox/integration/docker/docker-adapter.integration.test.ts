import { randomUUID } from "node:crypto";

import type Docker from "dockerode";
import { describe, expect } from "vitest";

import { SandboxProvider } from "../../src/index.js";
import { dockerAdapterIntegrationEnabled, it } from "./test-context.js";

const describeDockerAdapterIntegration = dockerAdapterIntegrationEnabled ? describe : describe.skip;
const START_MARKER_FILE_PATH = "/tmp/mistle-start-marker.txt";
const INJECTED_ENV_KEY = "MISTLE_SANDBOX_INJECTED_ENV";

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
  it("starts a sandbox from a base image and exposes its filesystem", async ({ fixture }) => {
    const startMarker = `mistle-docker-start-${randomUUID()}`;
    let sandboxId: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({ image: fixture.baseImage });
      sandboxId = sandbox.sandboxId;

      expect(sandbox.provider).toBe(SandboxProvider.DOCKER);
      expect(sandbox.sandboxId).not.toBe("");

      await writeSandboxFile({
        dockerClient: fixture.dockerClient,
        sandboxId: sandbox.sandboxId,
        path: START_MARKER_FILE_PATH,
        fileContents: startMarker,
      });

      const readback = await readSandboxFile({
        dockerClient: fixture.dockerClient,
        sandboxId: sandbox.sandboxId,
        path: START_MARKER_FILE_PATH,
      });
      expect(readback).toBe(startMarker);
    } finally {
      if (sandboxId !== undefined) {
        await fixture.adapter.stop({ sandboxId });
      }
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
});
