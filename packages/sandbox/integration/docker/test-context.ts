import { randomUUID } from "node:crypto";

import Docker from "dockerode";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { it as vitestIt } from "vitest";
import { z } from "zod";

import {
  SandboxProvider,
  createSandboxAdapter,
  type SandboxAdapter,
  type SandboxImageHandle,
} from "../../src/index.js";
import { resolveSandboxIntegrationSettings } from "../config.js";
import { resolveDockerAdapterIntegrationSettings } from "./config.js";

const REGISTRY_IMAGE_REFERENCE = "registry:3";
const REGISTRY_INTERNAL_PORT = 5000;
const BASE_IMAGE_SOURCE_REFERENCE = "registry:3";
const BASE_IMAGE_REPOSITORY_PATH = "mistle/base";

const DockerProgressMessageSchema = z
  .object({
    error: z.string().optional(),
    errorDetail: z
      .object({
        message: z.string().optional(),
      })
      .strip()
      .optional(),
  })
  .strip();
type DockerProgressMessage = z.output<typeof DockerProgressMessageSchema>;

type RegistryFixture = {
  container: StartedTestContainer;
  registryAuthority: string;
};

type DockerRegistryAuthConfig = {
  password: string;
  serveraddress: string;
  username: string;
};

export type DockerAdapterIntegrationFixture = {
  adapter: SandboxAdapter;
  baseImage: SandboxImageHandle;
  dockerClient: Docker;
};

export const sandboxIntegrationSettings = resolveSandboxIntegrationSettings(process.env);

export const dockerAdapterIntegrationEnabled =
  sandboxIntegrationSettings.enabled &&
  sandboxIntegrationSettings.providers.has(SandboxProvider.DOCKER);

export const dockerAdapterIntegrationSettings = resolveDockerAdapterIntegrationSettings({
  env: process.env,
  enabled: dockerAdapterIntegrationEnabled,
});

export const it = vitestIt.extend<{ fixture: DockerAdapterIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const settings = dockerAdapterIntegrationSettings;
      if (!settings.enabled) {
        throw new Error(
          'Docker adapter integration fixture requested while docker provider integration is disabled. Set MISTLE_TEST_SANDBOX_INTEGRATION=1 and include "docker" in MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS.',
        );
      }

      const registry = await startRegistry();
      const dockerClient = new Docker({
        socketPath: settings.socketPath,
      });
      const adapter = createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: settings.socketPath,
        },
      });

      try {
        const baseImage = await publishBaseImage({
          dockerClient,
          registryAuthority: registry.registryAuthority,
        });

        await use({
          adapter,
          baseImage,
          dockerClient,
        });
      } finally {
        await registry.container.stop();
      }
    },
    {
      scope: "file",
    },
  ],
});

export function createBaseImageHandle(baseImageId: string): SandboxImageHandle {
  return {
    provider: SandboxProvider.DOCKER,
    imageId: baseImageId,
    // This timestamp is metadata for the handle and not sent to Docker start calls.
    createdAt: new Date().toISOString(),
  };
}

async function publishBaseImage(input: {
  dockerClient: Docker;
  registryAuthority: string;
}): Promise<SandboxImageHandle> {
  await pullImage(input.dockerClient, BASE_IMAGE_SOURCE_REFERENCE);

  const baseRepository = `${input.registryAuthority}/${BASE_IMAGE_REPOSITORY_PATH}`;
  const baseTag = `base-${randomUUID().replaceAll("-", "")}`;
  const taggedBaseImageReference = `${baseRepository}:${baseTag}`;
  const sourceImage = input.dockerClient.getImage(BASE_IMAGE_SOURCE_REFERENCE);
  await sourceImage.tag({
    repo: baseRepository,
    tag: baseTag,
  });

  const taggedImage = input.dockerClient.getImage(taggedBaseImageReference);
  const pushStream = await taggedImage.push({
    authconfig: createRegistryAuthConfig(input.registryAuthority),
  });
  await consumeProgressStream(pushStream);

  return createBaseImageHandle(taggedBaseImageReference);
}

async function startRegistry(): Promise<RegistryFixture> {
  const container = await new GenericContainer(REGISTRY_IMAGE_REFERENCE)
    .withEnvironment({
      REGISTRY_STORAGE_DELETE_ENABLED: "true",
    })
    .withExposedPorts(REGISTRY_INTERNAL_PORT)
    .start();
  const registryAuthority = `127.0.0.1:${container.getMappedPort(REGISTRY_INTERNAL_PORT)}`;

  return {
    container,
    registryAuthority,
  };
}

async function pullImage(dockerClient: Docker, imageReference: string): Promise<void> {
  const pullStream = await dockerClient.pull(imageReference, {});
  await consumeProgressStream(pullStream);
}

function createRegistryAuthConfig(registryAuthority: string): DockerRegistryAuthConfig {
  // GitHub-hosted runners reject registry pushes that omit a valid auth header.
  return {
    username: "mistle",
    password: "mistle",
    serveraddress: registryAuthority,
  };
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

  throw new Error("Docker progress stream yielded a non-text chunk.");
}

function splitCompleteLines(buffer: string): {
  lines: string[];
  rest: string;
} {
  const lineBreakIndex = buffer.lastIndexOf("\n");

  if (lineBreakIndex < 0) {
    return {
      lines: [],
      rest: buffer,
    };
  }

  const complete = buffer.slice(0, lineBreakIndex);
  const rest = buffer.slice(lineBreakIndex + 1);

  return {
    lines: complete
      .split("\n")
      .map((line) => line.replace(/\r$/, ""))
      .filter((line) => line.length > 0),
    rest,
  };
}

function parseProgressMessage(line: string): DockerProgressMessage {
  const parsedJson: unknown = JSON.parse(line);
  return DockerProgressMessageSchema.parse(parsedJson);
}

async function consumeProgressStream(stream: NodeJS.ReadableStream): Promise<void> {
  let buffer = "";

  for await (const chunk of stream) {
    buffer += chunkToUtf8String(chunk);
    const { lines, rest } = splitCompleteLines(buffer);
    buffer = rest;

    for (const line of lines) {
      const message = parseProgressMessage(line);
      const daemonError = message.errorDetail?.message ?? message.error;

      if (daemonError !== undefined) {
        throw new Error(`Docker progress stream reported an error: ${daemonError}`);
      }
    }
  }

  if (buffer.trim().length > 0) {
    const trailingMessage = parseProgressMessage(buffer.trim());
    const daemonError = trailingMessage.errorDetail?.message ?? trailingMessage.error;
    if (daemonError !== undefined) {
      throw new Error(`Docker progress stream reported an error: ${daemonError}`);
    }
  }
}
