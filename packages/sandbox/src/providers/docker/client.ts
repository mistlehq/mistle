import Docker from "dockerode";
import { z } from "zod";

import { SandboxInspectDispositions, SandboxInspectStates } from "../../types.js";
import {
  DockerClientOperationIds,
  mapDockerClientError,
  type DockerClientOperation,
} from "./client-errors.js";
import {
  DockerCreateVolumeRequestSchema,
  DockerDeleteVolumeRequestSchema,
  DockerCaptureSandboxSnapshotRequestSchema,
  DockerPrepareVolumeForStartRequestSchema,
  DockerDestroySandboxRequestSchema,
  DockerInspectSandboxRequestSchema,
  DockerResumeSandboxRequestSchema,
  DockerStartSandboxRequestSchema,
  DockerStopSandboxRequestSchema,
  type DockerCreateVolumeRequest,
  type DockerDeleteVolumeRequest,
  type DockerCaptureSandboxSnapshotRequest,
  type DockerPrepareVolumeForStartRequest,
  type DockerDestroySandboxRequest,
  type DockerInspectSandboxRequest,
  type DockerResumeSandboxRequest,
  type DockerSandboxConfig,
  type DockerStartSandboxRequest,
  type DockerStopSandboxRequest,
} from "./schemas.js";
import {
  createDockerVolumeInitCommand,
  createDockerVolumeInitMounts,
  createDockerVolumeSubpathMounts,
} from "./storage.js";
import type { DockerSandboxInspectResult } from "./types.js";

type DockerHostConfig = Docker.HostConfig & {
  CgroupnsMode?: "host" | "private";
};

const DockerVolumeInitImageRef = "alpine:3.20";
const DockerHostGatewayExtraHost = "host.docker.internal:host-gateway";

export type DockerStartSandboxResponse = {
  runtimeId: string;
};

export type DockerCreateVolumeResponse = {
  volumeName: string;
};

export type DockerCaptureSandboxSnapshotResponse = {
  imageId: string;
};

export interface DockerClient {
  createVolume(request: DockerCreateVolumeRequest): Promise<DockerCreateVolumeResponse>;
  prepareVolumeForStart(request: DockerPrepareVolumeForStartRequest): Promise<void>;
  startSandbox(request: DockerStartSandboxRequest): Promise<DockerStartSandboxResponse>;
  inspectSandbox(request: DockerInspectSandboxRequest): Promise<DockerSandboxInspectResult>;
  resumeSandbox(request: DockerResumeSandboxRequest): Promise<DockerStartSandboxResponse>;
  captureSandboxSnapshot(
    request: DockerCaptureSandboxSnapshotRequest,
  ): Promise<DockerCaptureSandboxSnapshotResponse>;
  stopSandbox(request: DockerStopSandboxRequest): Promise<void>;
  deleteVolume(request: DockerDeleteVolumeRequest): Promise<void>;
  destroySandbox(request: DockerDestroySandboxRequest): Promise<void>;
}

const DockerCommitResponseSchema = z
  .object({
    Id: z.string().trim().min(1),
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

function normalizeDockerInspectState(state: string): DockerSandboxInspectResult["state"] {
  switch (state) {
    case "running":
      return SandboxInspectStates.RUNNING;
    case "created":
    case "paused":
    case "restarting":
    case "removing":
    case "exited":
    case "dead":
      return SandboxInspectStates.STOPPED;
    default:
      throw new Error(`Unsupported Docker container state: ${state}`);
  }
}

function normalizeDockerInspectDisposition(
  state: string,
): DockerSandboxInspectResult["disposition"] {
  // Docker exposes more lifecycle detail than the shared inspect contract.
  // This mapping preserves the distinction the data plane cares about without
  // leaking Docker-specific status handling into higher layers.
  switch (state) {
    case "running":
    case "restarting":
      return SandboxInspectDispositions.ACTIVE;
    case "paused":
    case "exited":
      return SandboxInspectDispositions.RESUMABLE_STOPPED;
    case "dead":
    case "removing":
      return SandboxInspectDispositions.TERMINAL_STOPPED;
    case "created":
      throw new Error("Sandbox inspect does not support Docker created containers.");
    default:
      throw new Error(`Unsupported Docker container disposition state: ${state}`);
  }
}

function normalizeDockerTimestamp(value: string): string | null {
  if (value.length === 0 || value.startsWith("0001-01-01")) {
    return null;
  }

  return value;
}

function isDockerLocalImageId(imageRef: string): boolean {
  return /^sha256:[a-f0-9]{64}$/i.test(imageRef);
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

  async createVolume(request: DockerCreateVolumeRequest): Promise<DockerCreateVolumeResponse> {
    const parsedRequest = DockerCreateVolumeRequestSchema.parse(request);

    await this.#runDockerClientOperation(DockerClientOperationIds.CREATE_VOLUME, () =>
      this.#docker.createVolume({
        Name: parsedRequest.volumeName,
      }),
    );

    return {
      volumeName: parsedRequest.volumeName,
    };
  }

  async prepareVolumeForStart(request: DockerPrepareVolumeForStartRequest): Promise<void> {
    const parsedRequest = DockerPrepareVolumeForStartRequestSchema.parse(request);
    await this.#pullImage(DockerVolumeInitImageRef);

    const hostConfig: DockerHostConfig = {
      Mounts: createDockerVolumeInitMounts({
        storage: parsedRequest.storagePreparation,
      }),
    };

    const container = await this.#runDockerClientOperation(
      DockerClientOperationIds.CREATE_CONTAINER,
      () =>
        this.#docker.createContainer({
          Image: DockerVolumeInitImageRef,
          Entrypoint: ["sh", "-lc"],
          Cmd: [createDockerVolumeInitCommand({ storage: parsedRequest.storagePreparation })],
          ...(Object.keys(hostConfig).length === 0 ? {} : { HostConfig: hostConfig }),
          Labels: {
            "mistle.sandbox.provider": "docker",
            "mistle.sandbox.storage_init": "true",
          },
        }),
    );

    try {
      await this.#runDockerClientOperation(DockerClientOperationIds.START_CONTAINER, () =>
        container.start(),
      );
    } catch (error) {
      await this.#tryRemoveContainer(container);
      throw error;
    }

    try {
      const waitResult = await this.#runDockerClientOperation(
        DockerClientOperationIds.WAIT_CONTAINER,
        () => container.wait(),
      );
      const statusCode =
        typeof waitResult.StatusCode === "number" ? waitResult.StatusCode : undefined;

      if (statusCode === 0) {
        return;
      }

      const logs = await this.#runDockerClientOperation(
        DockerClientOperationIds.CONTAINER_LOGS,
        () =>
          container.logs({
            stdout: true,
            stderr: true,
          }),
      );
      throw new Error(
        `Docker volume initialization container exited with status '${statusCode ?? "unknown"}': ${chunkToUtf8String(logs).trim()}`,
      );
    } finally {
      await this.#tryRemoveContainer(container);
    }
  }

  async startSandbox(request: DockerStartSandboxRequest): Promise<DockerStartSandboxResponse> {
    const parsedRequest = DockerStartSandboxRequestSchema.parse(request);

    if (!isDockerLocalImageId(parsedRequest.imageRef)) {
      await this.#pullImage(parsedRequest.imageRef);
    }

    const hostConfig = createDockerSandboxHostConfig({
      ...(this.#config.networkName === undefined ? {} : { networkName: this.#config.networkName }),
      ...(parsedRequest.storagePreparation === undefined
        ? {}
        : { storagePreparation: parsedRequest.storagePreparation }),
    });
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

    try {
      await this.#runDockerClientOperation(DockerClientOperationIds.START_CONTAINER, () =>
        container.start(),
      );
    } catch (error) {
      await this.#runDockerClientOperation(DockerClientOperationIds.REMOVE_CONTAINER, () =>
        container.remove({
          force: true,
        }),
      );
      throw error;
    }

    return {
      runtimeId: container.id,
    };
  }

  async inspectSandbox(request: DockerInspectSandboxRequest): Promise<DockerSandboxInspectResult> {
    const parsedRequest = DockerInspectSandboxRequestSchema.parse(request);
    const container = this.#docker.getContainer(parsedRequest.runtimeId);
    const inspect = await this.#runDockerClientOperation(
      DockerClientOperationIds.INSPECT_CONTAINER,
      () => container.inspect(),
    );

    return {
      provider: "docker",
      id: inspect.Id,
      state: normalizeDockerInspectState(inspect.State.Status),
      disposition: normalizeDockerInspectDisposition(inspect.State.Status),
      createdAt: inspect.Created,
      startedAt: normalizeDockerTimestamp(inspect.State.StartedAt),
      endedAt: normalizeDockerTimestamp(inspect.State.FinishedAt),
      raw: inspect,
    };
  }

  async captureSandboxSnapshot(
    request: DockerCaptureSandboxSnapshotRequest,
  ): Promise<DockerCaptureSandboxSnapshotResponse> {
    const parsedRequest = DockerCaptureSandboxSnapshotRequestSchema.parse(request);
    const container = await this.#resolveContainer(parsedRequest.runtimeId);
    const commitResult = DockerCommitResponseSchema.parse(
      await this.#runDockerClientOperation(DockerClientOperationIds.COMMIT_CONTAINER, () =>
        container.commit({
          pause: true,
        }),
      ),
    );

    return {
      imageId: commitResult.Id,
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

  async deleteVolume(request: DockerDeleteVolumeRequest): Promise<void> {
    const parsedRequest = DockerDeleteVolumeRequestSchema.parse(request);
    const volume = this.#docker.getVolume(parsedRequest.volumeName);

    await this.#runDockerClientOperation(DockerClientOperationIds.REMOVE_VOLUME, () =>
      volume.remove(),
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

  async #tryRemoveContainer(container: Docker.Container): Promise<void> {
    try {
      await this.#runDockerClientOperation(DockerClientOperationIds.REMOVE_CONTAINER, () =>
        container.remove({
          force: true,
        }),
      );
    } catch {}
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

export function createDockerSandboxHostConfig(input: {
  networkName?: string;
  storagePreparation?: DockerStartSandboxRequest["storagePreparation"];
}): DockerHostConfig {
  const hostConfig: DockerHostConfig = {
    ExtraHosts: [DockerHostGatewayExtraHost],
  };
  if (input.networkName !== undefined) {
    hostConfig.NetworkMode = input.networkName;
  }
  // Sandboxd PTY sessions create scoped cgroups under /sys/fs/cgroup, so the
  // sandbox container needs the host cgroup hierarchy mounted read-write and
  // exposed through the host cgroup namespace so child pids can move into the
  // sandbox-owned scopes.
  hostConfig.Binds = ["/sys/fs/cgroup:/sys/fs/cgroup:rw"];
  hostConfig.CgroupnsMode = "host";
  if (input.storagePreparation !== undefined) {
    hostConfig.Mounts = createDockerVolumeSubpathMounts({
      storage: input.storagePreparation,
    });
  }

  return hostConfig;
}
