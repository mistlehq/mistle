import { randomUUID } from "node:crypto";

import Docker from "dockerode";
import { z } from "zod";

import {
  DockerClientError,
  DockerClientOperationIds,
  mapDockerClientError,
  type DockerClientOperation,
} from "./client-errors.js";
import {
  DockerCloseSandboxStdinRequestSchema,
  DockerSnapshotSandboxRequestSchema,
  DockerStartSandboxRequestSchema,
  DockerStopSandboxRequestSchema,
  DockerWriteSandboxStdinRequestSchema,
  type DockerCloseSandboxStdinRequest,
  type DockerSandboxConfig,
  type DockerSnapshotSandboxRequest,
  type DockerStartSandboxRequest,
  type DockerStopSandboxRequest,
  type DockerWriteSandboxStdinRequest,
} from "./schemas.js";

export type DockerStartSandboxResponse = {
  sandboxId: string;
};

export type DockerSnapshotSandboxResponse = {
  imageId: string;
  createdAt: string;
};

export interface DockerClient {
  startSandbox(request: DockerStartSandboxRequest): Promise<DockerStartSandboxResponse>;
  writeSandboxStdin(request: DockerWriteSandboxStdinRequest): Promise<void>;
  closeSandboxStdin(request: DockerCloseSandboxStdinRequest): Promise<void>;
  snapshotSandbox(request: DockerSnapshotSandboxRequest): Promise<DockerSnapshotSandboxResponse>;
  stopSandbox(request: DockerStopSandboxRequest): Promise<void>;
}

const DockerProgressAuxSchema = z
  .object({
    Digest: z.string().optional(),
  })
  .strip();

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
    aux: DockerProgressAuxSchema.optional(),
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

function toImageReference(repository: string, digest: string): string {
  if (digest.includes("@")) {
    return digest;
  }

  return `${repository}@${digest}`;
}

function resolveRepositoryDigest(
  repoDigests: readonly string[] | undefined,
  repository: string,
): string | undefined {
  if (repoDigests === undefined) {
    return undefined;
  }

  return repoDigests.find((repoDigest) => repoDigest.startsWith(`${repository}@`));
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

type DestroyableReadWriteStream = NodeJS.ReadWriteStream & {
  destroy: (error?: Error) => void;
};

function isDestroyableReadWriteStream(
  stream: NodeJS.ReadWriteStream,
): stream is DestroyableReadWriteStream {
  return "destroy" in stream && typeof stream.destroy === "function";
}

function createAttachStdinOptions(): Docker.ContainerAttachOptions & {
  _query: {
    stdin: true;
    stream: true;
    stdout: false;
    stderr: false;
    logs: false;
  };
} {
  return {
    // dockerode uses this field internally to request HTTP upgrade for stdin streaming.
    hijack: true,
    stdin: true,
    stream: true,
    logs: false,
    stdout: false,
    stderr: false,
    // Ensure only daemon-supported attach query params are sent.
    _query: {
      stdin: true,
      stream: true,
      stdout: false,
      stderr: false,
      logs: false,
    },
  };
}

export class DockerApiClient implements DockerClient {
  readonly #config: DockerSandboxConfig;
  readonly #docker: Docker;
  readonly #attachedStdinStreams = new Map<string, NodeJS.ReadWriteStream>();

  constructor(config: DockerSandboxConfig) {
    this.#config = config;
    this.#docker = new Docker({
      socketPath: config.socketPath,
    });
  }

  async startSandbox(request: DockerStartSandboxRequest): Promise<DockerStartSandboxResponse> {
    const parsedRequest = DockerStartSandboxRequestSchema.parse(request);

    await this.#pullImage(parsedRequest.imageRef);

    const createContainerOptions: Docker.ContainerCreateOptions = {
      Image: parsedRequest.imageRef,
      OpenStdin: true,
      AttachStdin: true,
      StdinOnce: true,
      ...(parsedRequest.env === undefined ? {} : { Env: toDockerEnv(parsedRequest.env) }),
      Labels: {
        "mistle.sandbox.provider": "docker",
      },
    };

    const container = await this.#runDockerClientOperation(
      DockerClientOperationIds.CREATE_CONTAINER,
      () => this.#docker.createContainer(createContainerOptions),
    );
    const attachedStdinStream = await this.#runDockerClientOperation(
      DockerClientOperationIds.ATTACH_STDIN,
      () => container.attach(createAttachStdinOptions()),
    );
    this.#trackAttachedStdinStream(container.id, attachedStdinStream);

    await this.#runDockerClientOperation(DockerClientOperationIds.START_CONTAINER, () =>
      container.start(),
    );

    return {
      sandboxId: container.id,
    };
  }

  async writeSandboxStdin(request: DockerWriteSandboxStdinRequest): Promise<void> {
    const parsedRequest = DockerWriteSandboxStdinRequestSchema.parse(request);

    await this.#runDockerClientOperation(DockerClientOperationIds.WRITE_STDIN, async () => {
      const attachedStdinStream = await this.#getOrCreateAttachedStdinStream(
        parsedRequest.sandboxId,
      );
      await this.#writeAttachedStdinStream(attachedStdinStream, parsedRequest.payload);
    });
  }

  async closeSandboxStdin(request: DockerCloseSandboxStdinRequest): Promise<void> {
    const parsedRequest = DockerCloseSandboxStdinRequestSchema.parse(request);

    await this.#runDockerClientOperation(DockerClientOperationIds.CLOSE_STDIN, async () => {
      const attachedStdinStream = await this.#getOrCreateAttachedStdinStream(
        parsedRequest.sandboxId,
      );
      await this.#closeAttachedStdinStream(attachedStdinStream);
      this.#attachedStdinStreams.delete(parsedRequest.sandboxId);
    });
  }

  async snapshotSandbox(
    request: DockerSnapshotSandboxRequest,
  ): Promise<DockerSnapshotSandboxResponse> {
    const parsedRequest = DockerSnapshotSandboxRequestSchema.parse(request);
    const container = await this.#resolveContainer(parsedRequest.sandboxId);
    const snapshotTag = `snapshot-${randomUUID().replaceAll("-", "")}`;

    await this.#runDockerClientOperation(DockerClientOperationIds.COMMIT_CONTAINER, () =>
      container.commit({
        repo: this.#config.snapshotRepository,
        tag: snapshotTag,
      }),
    );

    const pushedImageTag = `${this.#config.snapshotRepository}:${snapshotTag}`;
    const pushedImage = this.#docker.getImage(pushedImageTag);
    const pushMessages = await this.#pushImage(pushedImage);

    const digestFromPush = pushMessages
      .map((message) => message.aux?.Digest)
      .find((digest): digest is string => digest !== undefined);

    let imageId: string | undefined =
      digestFromPush === undefined
        ? undefined
        : toImageReference(this.#config.snapshotRepository, digestFromPush);

    if (imageId === undefined) {
      const imageInspect = await this.#runDockerClientOperation(
        DockerClientOperationIds.INSPECT_IMAGE,
        () => pushedImage.inspect(),
      );
      imageId = resolveRepositoryDigest(imageInspect.RepoDigests, this.#config.snapshotRepository);
    }

    if (imageId === undefined) {
      throw new DockerClientError({
        code: "unknown",
        operation: DockerClientOperationIds.INSPECT_IMAGE,
        retryable: false,
        message:
          "Docker operation `inspect_image` failed: Unable to resolve pushed image digest for snapshot repository.",
        cause: new Error("No digest was returned by docker push or image inspect."),
      });
    }

    return {
      imageId,
      createdAt: new Date().toISOString(),
    };
  }

  async stopSandbox(request: DockerStopSandboxRequest): Promise<void> {
    const parsedRequest = DockerStopSandboxRequestSchema.parse(request);
    this.#releaseTrackedStdinStream(parsedRequest.sandboxId);
    const container = await this.#resolveContainer(parsedRequest.sandboxId);

    await this.#runDockerClientOperation(DockerClientOperationIds.REMOVE_CONTAINER, () =>
      container.remove({
        force: true,
      }),
    );
  }

  async #resolveContainer(sandboxId: string): Promise<Docker.Container> {
    const container = this.#docker.getContainer(sandboxId);

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

  async #pushImage(image: Docker.Image): Promise<ReadonlyArray<DockerProgressMessage>> {
    const pushStream = await this.#runDockerClientOperation(
      DockerClientOperationIds.PUSH_IMAGE,
      () => image.push({}),
    );

    return this.#consumeProgressStream(DockerClientOperationIds.PUSH_IMAGE, pushStream);
  }

  async #getOrCreateAttachedStdinStream(sandboxId: string): Promise<NodeJS.ReadWriteStream> {
    const existingAttachedStdinStream = this.#attachedStdinStreams.get(sandboxId);
    if (existingAttachedStdinStream !== undefined) {
      return existingAttachedStdinStream;
    }

    const container = this.#docker.getContainer(sandboxId);
    const attachedStdinStream = await this.#runDockerClientOperation(
      DockerClientOperationIds.ATTACH_STDIN,
      () => container.attach(createAttachStdinOptions()),
    );
    this.#trackAttachedStdinStream(sandboxId, attachedStdinStream);

    return attachedStdinStream;
  }

  #trackAttachedStdinStream(sandboxId: string, attachedStdinStream: NodeJS.ReadWriteStream): void {
    attachedStdinStream.on("data", () => {
      // Drain attached stdout/stderr bytes so stream backpressure cannot block stdin writes.
    });

    const clearAttachedStdinStream = () => {
      if (this.#attachedStdinStreams.get(sandboxId) === attachedStdinStream) {
        this.#attachedStdinStreams.delete(sandboxId);
      }
    };
    attachedStdinStream.once("close", clearAttachedStdinStream);
    attachedStdinStream.once("error", clearAttachedStdinStream);

    this.#attachedStdinStreams.set(sandboxId, attachedStdinStream);
  }

  async #writeAttachedStdinStream(
    attachedStdinStream: NodeJS.ReadWriteStream,
    payload: Uint8Array<ArrayBufferLike>,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      attachedStdinStream.write(Buffer.from(payload), (error?: Error | null) => {
        if (error !== undefined && error !== null) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  async #closeAttachedStdinStream(attachedStdinStream: NodeJS.ReadWriteStream): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = (error?: Error | null) => {
        if (settled) {
          return;
        }
        settled = true;

        attachedStdinStream.off("close", handleClose);
        attachedStdinStream.off("error", handleError);

        if (error !== undefined && error !== null) {
          reject(error);
          return;
        }

        resolve();
      };

      const handleClose = () => {
        finish();
      };
      const handleError = (error: Error) => {
        finish(error);
      };

      attachedStdinStream.once("close", handleClose);
      attachedStdinStream.once("error", handleError);

      attachedStdinStream.end((error?: Error | null) => {
        if (error !== undefined && error !== null) {
          finish(error);
          return;
        }

        // Docker closes container stdin on attach disconnect (StdinOnce), so ensure
        // the hijacked stream is fully disconnected after writing EOF.
        if (!isDestroyableReadWriteStream(attachedStdinStream)) {
          finish(new Error("Attached stdin stream is not destroyable."));
          return;
        }
        attachedStdinStream.destroy();
      });
    });
  }

  #releaseTrackedStdinStream(sandboxId: string): void {
    const trackedAttachedStdinStream = this.#attachedStdinStreams.get(sandboxId);
    if (trackedAttachedStdinStream === undefined) {
      return;
    }

    this.#attachedStdinStreams.delete(sandboxId);
    trackedAttachedStdinStream.end();
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
