import Docker from "dockerode";
import { z } from "zod";

import {
  DockerClientOperationIds,
  mapDockerClientError,
  type DockerClientOperation,
} from "./client-errors.js";
import {
  DockerDestroySandboxRequestSchema,
  DockerResumeSandboxRequestSchema,
  DockerStartSandboxRequestSchema,
  DockerStopSandboxRequestSchema,
  type DockerDestroySandboxRequest,
  type DockerResumeSandboxRequest,
  type DockerSandboxConfig,
  type DockerStartSandboxRequest,
  type DockerStopSandboxRequest,
} from "./schemas.js";

export type DockerStartSandboxResponse = {
  runtimeId: string;
};

export interface DockerClient {
  startSandbox(request: DockerStartSandboxRequest): Promise<DockerStartSandboxResponse>;
  resumeSandbox(request: DockerResumeSandboxRequest): Promise<DockerStartSandboxResponse>;
  stopSandbox(request: DockerStopSandboxRequest): Promise<void>;
  destroySandbox(request: DockerDestroySandboxRequest): Promise<void>;
}

const DockerProgressMessageSchema = z
  .object({
    status: z.string().optional(),
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

  throw new Error("Docker stream yielded a non-text chunk.");
}

function parseProgressMessage(line: string): DockerProgressMessage {
  const parsedJson: unknown = JSON.parse(line);
  return DockerProgressMessageSchema.parse(parsedJson);
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

function toDockerEnv(env: Record<string, string> | undefined): string[] | undefined {
  if (env === undefined) {
    return undefined;
  }

  const entries = Object.entries(env);
  if (entries.length === 0) {
    return undefined;
  }

  return entries.map(([key, value]) => `${key}=${value}`);
}

export class DockerApiClient implements DockerClient {
  readonly #config: DockerSandboxConfig;
  readonly #docker: Docker;

  constructor(config: DockerSandboxConfig) {
    this.#config = config;
    this.#docker = new Docker({
      socketPath: config.socketPath,
    });
  }

  async startSandbox(request: DockerStartSandboxRequest): Promise<DockerStartSandboxResponse> {
    const parsedRequest = DockerStartSandboxRequestSchema.parse(request);

    await this.#pullImage(parsedRequest.imageRef);

    const hostConfig: Docker.HostConfig = {};
    if (this.#config.networkName !== undefined) {
      hostConfig.NetworkMode = this.#config.networkName;
    }
    const createContainerOptions: Docker.ContainerCreateOptions = {
      Image: parsedRequest.imageRef,
      ...(parsedRequest.env === undefined ? {} : { Env: toDockerEnv(parsedRequest.env) }),
      ...(Object.keys(hostConfig).length === 0 ? {} : { HostConfig: hostConfig }),
      Labels: {
        "mistle.sandbox.provider": "docker",
      },
    };

    const container = await this.#runDockerClientOperation(
      DockerClientOperationIds.CREATE_CONTAINER,
      () => this.#docker.createContainer(createContainerOptions),
    );
    await this.#runDockerClientOperation(DockerClientOperationIds.START_CONTAINER, () =>
      container.start(),
    );

    return {
      runtimeId: container.id,
    };
  }

  async stopSandbox(request: DockerStopSandboxRequest): Promise<void> {
    const parsedRequest = DockerStopSandboxRequestSchema.parse(request);
    const container = await this.#resolveContainer(parsedRequest.runtimeId);

    await this.#runDockerClientOperation(DockerClientOperationIds.STOP_CONTAINER, () =>
      container.stop(),
    );
  }

  async resumeSandbox(request: DockerResumeSandboxRequest): Promise<DockerStartSandboxResponse> {
    const parsedRequest = DockerResumeSandboxRequestSchema.parse(request);
    const container = await this.#resolveContainer(parsedRequest.runtimeId);

    await this.#runDockerClientOperation(DockerClientOperationIds.START_CONTAINER, () =>
      container.start(),
    );

    return {
      runtimeId: parsedRequest.runtimeId,
    };
  }

  async destroySandbox(request: DockerDestroySandboxRequest): Promise<void> {
    const parsedRequest = DockerDestroySandboxRequestSchema.parse(request);
    const container = await this.#resolveContainer(parsedRequest.runtimeId);

    await this.#runDockerClientOperation(DockerClientOperationIds.REMOVE_CONTAINER, () =>
      container.remove({
        force: true,
      }),
    );
  }

  async #resolveContainer(runtimeId: string): Promise<Docker.Container> {
    const container = this.#docker.getContainer(runtimeId);

    await this.#runDockerClientOperation(DockerClientOperationIds.RESOLVE_CONTAINER, () =>
      container.inspect(),
    );

    return container;
  }

  async #pullImage(imageRef: string): Promise<void> {
    const pullStream = await this.#runDockerClientOperation(
      DockerClientOperationIds.PULL_IMAGE,
      () => this.#docker.pull(imageRef, {}),
    );

    await this.#consumeProgressStream(DockerClientOperationIds.PULL_IMAGE, pullStream);
  }

  async #consumeProgressStream(
    operation: DockerClientOperation,
    stream: NodeJS.ReadableStream,
  ): Promise<ReadonlyArray<DockerProgressMessage>> {
    const messages: DockerProgressMessage[] = [];
    let buffer = "";

    try {
      for await (const chunk of stream) {
        buffer += chunkToUtf8String(chunk);
        const { lines, rest } = splitCompleteLines(buffer);
        buffer = rest;

        for (const line of lines) {
          const message = parseProgressMessage(line);
          const daemonError = message.errorDetail?.message ?? message.error;

          if (daemonError !== undefined) {
            throw new Error(daemonError);
          }

          messages.push(message);
        }
      }

      if (buffer.trim().length > 0) {
        const trailingMessage = parseProgressMessage(buffer.trim());
        const daemonError = trailingMessage.errorDetail?.message ?? trailingMessage.error;

        if (daemonError !== undefined) {
          throw new Error(daemonError);
        }

        messages.push(trailingMessage);
      }

      return messages;
    } catch (error) {
      throw mapDockerClientError(operation, error);
    }
  }

  async #runDockerClientOperation<TResult>(
    operation: DockerClientOperation,
    operationFn: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await operationFn();
    } catch (error) {
      throw mapDockerClientError(operation, error);
    }
  }
}
