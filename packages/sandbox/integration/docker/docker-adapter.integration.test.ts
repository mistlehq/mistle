import { randomUUID } from "node:crypto";

import type Docker from "dockerode";
import { describe, expect } from "vitest";

import {
  createDockerClient,
  SandboxPersistentStorageLayout,
  SandboxProvider,
  SandboxResourceNotFoundError,
  SandboxRuntimeEnv,
  SandboxRuntimeEnvDefaults,
  SandboxStorageBackend,
} from "../../src/index.js";
import { createDockerAdapter } from "../../src/providers/docker/index.js";
import {
  createBaseImageHandle,
  dockerAdapterIntegrationEnabled,
  dockerAdapterIntegrationSettings,
  it,
} from "./test-context.js";

const describeDockerAdapterIntegration = dockerAdapterIntegrationEnabled ? describe : describe.skip;
const START_MARKER_FILE_PATH = "/tmp/mistle-start-marker.txt";
const INJECTED_ENV_KEY = "MISTLE_SANDBOX_INJECTED_ENV";
const SandboxBaseImageReference = "ghcr.io/mistlehq/sandbox-base:latest";

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

async function pullDockerImage(input: {
  dockerClient: Docker;
  imageReference: string;
}): Promise<void> {
  const stream = await input.dockerClient.pull(input.imageReference, {});

  await new Promise<void>((resolve, reject) => {
    input.dockerClient.modem.followProgress(stream, (error: unknown) => {
      if (error instanceof Error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
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
  it("creates and deletes a named Docker volume", async ({ fixture }) => {
    if (!dockerAdapterIntegrationSettings.enabled) {
      throw new Error("Docker integration settings are required for the volume lifecycle test.");
    }

    const volumeName = `mistle-pr12-${randomUUID()}`;
    const dockerClient = createDockerClient({
      socketPath: dockerAdapterIntegrationSettings.socketPath,
    });

    await dockerClient.createVolume({
      volumeName,
    });

    const inspectBeforeDelete = await fixture.dockerClient.getVolume(volumeName).inspect();
    expect(inspectBeforeDelete.Name).toBe(volumeName);

    await dockerClient.deleteVolume({
      volumeName,
    });

    await expect(fixture.dockerClient.getVolume(volumeName).inspect()).rejects.toBeInstanceOf(
      Error,
    );
  }, 300_000);

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
          `printenv ${INJECTED_ENV_KEY} && printenv ${SandboxRuntimeEnv.LISTEN_ADDR}`,
        ],
      });

      expect(result.exitCode).toBe(0);
      expect(normalizeOutput(result.output)).toBe(
        [injectedEnvValue, SandboxRuntimeEnvDefaults.LISTEN_ADDR].join("\n"),
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

  it("starts persistent sandboxes with docker volume subpath mounts", async ({ fixture }) => {
    if (!dockerAdapterIntegrationSettings.enabled) {
      throw new Error("Docker integration settings are required for the persistent storage test.");
    }

    const dockerClient = createDockerClient({
      socketPath: dockerAdapterIntegrationSettings.socketPath,
    });
    const volumeName = `mistle-pr13-${randomUUID()}`;
    const rootMarkerPath = "/root/.mistle-durable-root.txt";
    const codexMarkerPath = "/etc/codex/.mistle-durable-codex.txt";
    const binMarkerPath = "/usr/local/bin/.mistle-durable-bin.txt";
    const rootMarker = `root-${randomUUID()}`;
    const codexMarker = `codex-${randomUUID()}`;
    const binMarker = `bin-${randomUUID()}`;
    let firstSandboxId: string | undefined;
    let secondSandboxId: string | undefined;

    try {
      await dockerClient.createVolume({
        volumeName,
      });

      const storagePreparation = await fixture.adapter.prepareStorageForStart({
        sandboxInstanceId: `sbi_${randomUUID().replaceAll("-", "").slice(0, 26)}`,
        image: fixture.baseImage,
        storage: {
          backend: SandboxStorageBackend.DOCKER_VOLUME,
          handle: volumeName,
          layout: SandboxPersistentStorageLayout,
        },
      });

      const firstSandbox = await fixture.adapter.start({
        image: fixture.baseImage,
        storagePreparation,
      });
      firstSandboxId = firstSandbox.id;

      const firstInspection = await fixture.adapter.inspect({ id: firstSandbox.id });
      if (firstInspection.provider !== SandboxProvider.DOCKER) {
        throw new Error("Expected Docker sandbox inspection result for persistent sandbox.");
      }

      expect(firstInspection.raw.Mounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            Type: "volume",
            Name: volumeName,
            Destination: "/root",
          }),
          expect.objectContaining({
            Type: "volume",
            Name: volumeName,
            Destination: "/etc/codex",
          }),
          expect.objectContaining({
            Type: "volume",
            Name: volumeName,
            Destination: "/usr/local/bin",
          }),
        ]),
      );

      await writeSandboxFile({
        dockerClient: fixture.dockerClient,
        id: firstSandbox.id,
        path: rootMarkerPath,
        fileContents: rootMarker,
      });
      await writeSandboxFile({
        dockerClient: fixture.dockerClient,
        id: firstSandbox.id,
        path: codexMarkerPath,
        fileContents: codexMarker,
      });
      await writeSandboxFile({
        dockerClient: fixture.dockerClient,
        id: firstSandbox.id,
        path: binMarkerPath,
        fileContents: binMarker,
      });

      await fixture.adapter.destroy({ id: firstSandbox.id });
      firstSandboxId = undefined;

      const secondPreparation = await fixture.adapter.prepareStorageForStart({
        sandboxInstanceId: `sbi_${randomUUID().replaceAll("-", "").slice(0, 26)}`,
        image: fixture.baseImage,
        storage: {
          backend: SandboxStorageBackend.DOCKER_VOLUME,
          handle: volumeName,
          layout: SandboxPersistentStorageLayout,
        },
      });

      const secondSandbox = await fixture.adapter.start({
        image: fixture.baseImage,
        storagePreparation: secondPreparation,
      });
      secondSandboxId = secondSandbox.id;

      await expect(
        readSandboxFile({
          dockerClient: fixture.dockerClient,
          id: secondSandbox.id,
          path: rootMarkerPath,
        }),
      ).resolves.toBe(rootMarker);
      await expect(
        readSandboxFile({
          dockerClient: fixture.dockerClient,
          id: secondSandbox.id,
          path: codexMarkerPath,
        }),
      ).resolves.toBe(codexMarker);
      await expect(
        readSandboxFile({
          dockerClient: fixture.dockerClient,
          id: secondSandbox.id,
          path: binMarkerPath,
        }),
      ).resolves.toBe(binMarker);
    } finally {
      if (firstSandboxId !== undefined) {
        await fixture.adapter.destroy({ id: firstSandboxId });
      }
      if (secondSandboxId !== undefined) {
        await fixture.adapter.destroy({ id: secondSandboxId });
      }
      try {
        await dockerClient.deleteVolume({
          volumeName,
        });
      } catch {}
    }
  }, 300_000);

  it("prepares Docker volumes for start with a lightweight helper image even when the sandbox image is the real base image", async ({
    fixture,
  }) => {
    if (!dockerAdapterIntegrationSettings.enabled) {
      throw new Error(
        "Docker integration settings are required for the volume initialization test.",
      );
    }

    const dockerClient = createDockerClient({
      socketPath: dockerAdapterIntegrationSettings.socketPath,
    });
    const volumeName = `mistle-pr13-init-${randomUUID()}`;
    let inspectorContainerId: string | undefined;

    try {
      await pullDockerImage({
        dockerClient: fixture.dockerClient,
        imageReference: "alpine:3.20",
      });
      await dockerClient.createVolume({
        volumeName,
      });

      await fixture.adapter.prepareStorageForStart({
        sandboxInstanceId: `sbi_${randomUUID().replaceAll("-", "").slice(0, 26)}`,
        image: createBaseImageHandle(SandboxBaseImageReference),
        storage: {
          backend: SandboxStorageBackend.DOCKER_VOLUME,
          handle: volumeName,
          layout: SandboxPersistentStorageLayout,
        },
      });

      const inspectorContainer = await fixture.dockerClient.createContainer({
        Image: "alpine:3.20",
        Cmd: [
          "sh",
          "-lc",
          "test -d /mnt/root && test -d /mnt/etc/codex && test -d /mnt/usr/local/bin",
        ],
        HostConfig: {
          Mounts: [
            {
              Type: "volume",
              Source: volumeName,
              Target: "/mnt",
            },
          ],
        },
      });
      inspectorContainerId = inspectorContainer.id;

      await inspectorContainer.start();
      await expect(inspectorContainer.wait()).resolves.toMatchObject({
        StatusCode: 0,
      });
    } finally {
      if (inspectorContainerId !== undefined) {
        await fixture.dockerClient.getContainer(inspectorContainerId).remove({
          force: true,
        });
      }

      try {
        await dockerClient.deleteVolume({
          volumeName,
        });
      } catch {}
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
