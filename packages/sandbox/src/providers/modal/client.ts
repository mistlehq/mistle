import {
  ModalClient,
  type App,
  type Image,
  type Sandbox,
  type SandboxCreateParams,
  type StdioBehavior,
} from "modal";

import { withRequiredSandboxRuntimeEnv } from "../../runtime-env.js";
import { SandboxInspectDispositions, SandboxInspectStates, SandboxProvider } from "../../types.js";
import {
  ModalClientError,
  ModalClientErrorCodes,
  ModalClientOperationIds,
  ModalCommandExitError,
  mapModalClientError,
  type ModalClientOperation,
} from "./client-errors.js";
import type { ModalSandboxConfig, ValidatedModalSandboxConfig } from "./config.js";
import {
  ModalCaptureSandboxSnapshotRequestSchema,
  ModalImageRequestSchema,
  ModalRuntimeControlRequestSchema,
  ModalSandboxIdRequestSchema,
  ModalStartSandboxRequestSchema,
  validateModalStartResources,
  type ModalCaptureSandboxSnapshotRequest,
  type ModalImageRequest,
  type ModalRuntimeControlRequest,
  type ModalSandboxIdRequest,
  type ModalStartSandboxRequest,
} from "./schemas.js";
import type { ModalSandboxInspectResult } from "./types.js";

const ModalDefaultSandboxCommand = ["sleep", "48h"] as const;
const ModalVmRuntimeExperimentalOptions = { vm_runtime: true } as const;
const ModalEntrypointResetCommand = "ENTRYPOINT []";
const ModalInspectProbeCommand = ["true"] as const;
const ModalNativeImageIdPattern = /^im-[A-Za-z0-9]+$/u;
export const ModalDefaultSandboxTimeoutMs = 24 * 60 * 60 * 1000;

export type ModalStartSandboxResponse = { sandboxId: string };
export type ModalCaptureSandboxSnapshotResponse = { imageId: string };
export type ModalRunCommandResponse = {
  readonly stdout: string;
  readonly stderr: string;
  readonly statusCode: number;
};

export interface ModalClientApi {
  prepareImage(request: ModalImageRequest): Promise<{ imageId: string }>;
  startSandbox(request: ModalStartSandboxRequest): Promise<ModalStartSandboxResponse>;
  inspectSandbox(request: ModalSandboxIdRequest): Promise<ModalSandboxInspectResult>;
  captureSandboxSnapshot(
    request: ModalCaptureSandboxSnapshotRequest,
  ): Promise<ModalCaptureSandboxSnapshotResponse>;
  stopSandbox(request: ModalSandboxIdRequest): Promise<void>;
  destroySandbox(request: ModalSandboxIdRequest): Promise<void>;
  activate(request: ModalRuntimeControlRequest): Promise<void>;
  runCommand(request: {
    sandboxId: string;
    command: string;
    args?: readonly string[];
    operation: ModalClientOperation;
    commandDescription: string;
    env?: Record<string, string>;
    workingDir?: string;
    stdout?: StdioBehavior;
    stderr?: StdioBehavior;
    timeoutMs?: number;
  }): Promise<ModalRunCommandResponse>;
  startCommand(request: {
    sandboxId: string;
    command: string;
    args?: readonly string[];
    operation: ModalClientOperation;
    commandDescription: string;
    env?: Record<string, string>;
    workingDir?: string;
    stdout?: StdioBehavior;
    stderr?: StdioBehavior;
    timeoutMs?: number;
  }): Promise<void>;
  close(): void;
}

export class ModalApiClient implements ModalClientApi {
  readonly #config: ValidatedModalSandboxConfig;
  readonly #client: ModalClient;
  #app: App | undefined;

  constructor(input: { config: ValidatedModalSandboxConfig }) {
    this.#config = input.config;
    this.#client = createModalSdkClient(input.config);
  }

  async prepareImage(request: ModalImageRequest): Promise<{ imageId: string }> {
    const parsedRequest = ModalImageRequestSchema.parse(request);
    if (isModalNativeImageId(parsedRequest.imageId)) {
      return { imageId: parsedRequest.imageId };
    }

    try {
      const image = await this.#buildEntrypointClearedImage(parsedRequest.imageId);
      return { imageId: image.imageId };
    } catch (error) {
      throw mapModalClientError(ModalClientOperationIds.BUILD_BASE_IMAGE, error);
    }
  }

  async startSandbox(request: ModalStartSandboxRequest): Promise<ModalStartSandboxResponse> {
    const parsedRequest = ModalStartSandboxRequestSchema.parse(request);
    if (parsedRequest.resources !== undefined) {
      validateModalStartResources(parsedRequest.resources);
    }

    try {
      const app = await this.#getApp();
      const image = await this.#client.images.fromId(parsedRequest.imageId);
      const createParams = createModalSandboxCreateParams(parsedRequest, this.#config);
      const sandbox = await this.#client.sandboxes.create(app, image, {
        ...createParams,
        experimentalOptions: ModalVmRuntimeExperimentalOptions,
        ...(parsedRequest.sandboxInstanceId === undefined
          ? {}
          : {
              tags: {
                mistle_sandbox_instance_id: parsedRequest.sandboxInstanceId,
              },
            }),
      });
      return { sandboxId: sandbox.sandboxId };
    } catch (error) {
      throw mapModalClientError(ModalClientOperationIds.CREATE_SANDBOX, error);
    }
  }

  async inspectSandbox(request: ModalSandboxIdRequest): Promise<ModalSandboxInspectResult> {
    const parsedRequest = ModalSandboxIdRequestSchema.parse(request);

    try {
      const sandbox = await this.#client.sandboxes.fromId(parsedRequest.sandboxId);
      const exitCode = await sandbox.poll();
      if (exitCode !== null) {
        return {
          provider: SandboxProvider.MODAL,
          id: parsedRequest.sandboxId,
          state: SandboxInspectStates.STOPPED,
          disposition: SandboxInspectDispositions.TERMINAL_STOPPED,
          createdAt: null,
          startedAt: null,
          endedAt: null,
          raw: { reachable: true, exitCode },
        };
      }

      await this.#runProcess({
        sandbox,
        command: [...ModalInspectProbeCommand],
        operation: ModalClientOperationIds.GET_SANDBOX_INFO,
        commandDescription: "Inspect Modal sandbox",
      });

      return {
        provider: SandboxProvider.MODAL,
        id: parsedRequest.sandboxId,
        state: SandboxInspectStates.RUNNING,
        disposition: SandboxInspectDispositions.ACTIVE,
        createdAt: null,
        startedAt: null,
        endedAt: null,
        raw: { reachable: true, exitCode: null },
      };
    } catch (error) {
      throw mapModalClientError(ModalClientOperationIds.GET_SANDBOX_INFO, error);
    }
  }

  async captureSandboxSnapshot(
    request: ModalCaptureSandboxSnapshotRequest,
  ): Promise<ModalCaptureSandboxSnapshotResponse> {
    const parsedRequest = ModalCaptureSandboxSnapshotRequestSchema.parse(request);

    try {
      const sandbox = await this.#client.sandboxes.fromId(parsedRequest.sandboxId);
      const image = await sandbox.snapshotFilesystem(parsedRequest.requestTimeoutMs);
      return { imageId: image.imageId };
    } catch (error) {
      throw mapModalClientError(ModalClientOperationIds.CREATE_SNAPSHOT, error);
    }
  }

  async stopSandbox(request: ModalSandboxIdRequest): Promise<void> {
    const parsedRequest = ModalSandboxIdRequestSchema.parse(request);

    try {
      const sandbox = await this.#client.sandboxes.fromId(parsedRequest.sandboxId);
      await sandbox.terminate();
    } catch (error) {
      throw mapModalClientError(ModalClientOperationIds.TERMINATE_SANDBOX, error);
    }
  }

  async destroySandbox(request: ModalSandboxIdRequest): Promise<void> {
    await this.stopSandbox(request);
  }

  async activate(request: ModalRuntimeControlRequest): Promise<void> {
    const parsedRequest = ModalRuntimeControlRequestSchema.parse(request);

    try {
      const sandbox = await this.#client.sandboxes.fromId(parsedRequest.sandboxId);
      const process = await sandbox.exec(
        [
          "/opt/mistle/bin/sandboxd",
          "activate",
          "--stdin-bytes",
          String(parsedRequest.payload.byteLength),
        ],
        {
          mode: "binary",
          timeoutMs: parsedRequest.timeoutMs,
          ...(parsedRequest.env === undefined
            ? {}
            : { env: withRequiredSandboxRuntimeEnv(parsedRequest.env) }),
        },
      );
      await process.stdin.writeBytes(parsedRequest.payload);
      await process.stdin.close();
      const exitCode = await process.wait();
      const stdout = new TextDecoder().decode(await process.stdout.readBytes());
      const stderr = new TextDecoder().decode(await process.stderr.readBytes());
      if (exitCode !== 0) {
        throw new ModalCommandExitError({
          operation: ModalClientOperationIds.ACTIVATE,
          commandDescription: "Activate sandboxd",
          exitCode,
          stdout,
          stderr,
        });
      }
    } catch (error) {
      throw mapModalClientError(ModalClientOperationIds.ACTIVATE, error);
    }
  }

  async runCommand(request: {
    sandboxId: string;
    command: string;
    args?: readonly string[];
    operation: ModalClientOperation;
    commandDescription: string;
    env?: Record<string, string>;
    workingDir?: string;
    stdout?: StdioBehavior;
    stderr?: StdioBehavior;
    timeoutMs?: number;
  }): Promise<ModalRunCommandResponse> {
    const parsedSandboxId = ModalSandboxIdRequestSchema.parse({
      sandboxId: request.sandboxId,
    }).sandboxId;

    try {
      const sandbox = await this.#client.sandboxes.fromId(parsedSandboxId);
      return await this.#runProcess({
        sandbox,
        command:
          request.args === undefined
            ? ["sh", "-euc", request.command]
            : [request.command, ...request.args],
        operation: request.operation,
        commandDescription: request.commandDescription,
        ...(request.env === undefined ? {} : { env: request.env }),
        ...(request.workingDir === undefined ? {} : { workingDir: request.workingDir }),
        ...(request.stdout === undefined ? {} : { stdout: request.stdout }),
        ...(request.stderr === undefined ? {} : { stderr: request.stderr }),
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      });
    } catch (error) {
      throw mapModalClientError(request.operation, error);
    }
  }

  async startCommand(request: {
    sandboxId: string;
    command: string;
    args?: readonly string[];
    operation: ModalClientOperation;
    commandDescription: string;
    env?: Record<string, string>;
    workingDir?: string;
    stdout?: StdioBehavior;
    stderr?: StdioBehavior;
    timeoutMs?: number;
  }): Promise<void> {
    const parsedSandboxId = ModalSandboxIdRequestSchema.parse({
      sandboxId: request.sandboxId,
    }).sandboxId;

    try {
      const sandbox = await this.#client.sandboxes.fromId(parsedSandboxId);
      await sandbox.exec(
        request.args === undefined ? [request.command] : [request.command, ...request.args],
        {
          mode: "text",
          ...(request.env === undefined ? {} : { env: withRequiredSandboxRuntimeEnv(request.env) }),
          ...(request.workingDir === undefined ? {} : { workdir: request.workingDir }),
          ...(request.stdout === undefined ? {} : { stdout: request.stdout }),
          ...(request.stderr === undefined ? {} : { stderr: request.stderr }),
          ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
        },
      );
    } catch (error) {
      throw mapModalClientError(request.operation, error);
    }
  }

  close(): void {
    this.#client.close();
  }

  async #getApp(): Promise<App> {
    if (this.#app === undefined) {
      this.#app = await this.#client.apps.fromName(this.#config.appName, {
        createIfMissing: true,
        ...(this.#config.environment === undefined
          ? {}
          : { environment: this.#config.environment }),
      });
    }
    return this.#app;
  }

  async #buildEntrypointClearedImage(imageRef: string): Promise<Image> {
    const app = await this.#getApp();
    const image = this.#client.images
      .fromRegistry(imageRef)
      .dockerfileCommands([ModalEntrypointResetCommand]);
    return await image.build(app);
  }

  async #runProcess(input: {
    sandbox: Sandbox;
    command: readonly string[];
    operation: ModalClientOperation;
    commandDescription: string;
    env?: Record<string, string>;
    workingDir?: string;
    stdout?: StdioBehavior;
    stderr?: StdioBehavior;
    timeoutMs?: number;
  }): Promise<ModalRunCommandResponse> {
    const process = await input.sandbox.exec([...input.command], {
      mode: "text",
      ...(input.env === undefined ? {} : { env: withRequiredSandboxRuntimeEnv(input.env) }),
      ...(input.workingDir === undefined ? {} : { workdir: input.workingDir }),
      ...(input.stdout === undefined ? {} : { stdout: input.stdout }),
      ...(input.stderr === undefined ? {} : { stderr: input.stderr }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });
    const exitCode = await process.wait();
    const stdout = input.stdout === "ignore" ? "" : await process.stdout.readText();
    const stderr = input.stderr === "ignore" ? "" : await process.stderr.readText();
    if (exitCode !== 0) {
      throw new ModalCommandExitError({
        operation: input.operation,
        commandDescription: input.commandDescription,
        exitCode,
        stdout,
        stderr,
      });
    }
    return { stdout, stderr, statusCode: exitCode };
  }
}

export function isModalNativeImageId(imageId: string): boolean {
  return ModalNativeImageIdPattern.test(imageId.trim());
}

function createModalSandboxCreateParams(
  request: ModalStartSandboxRequest,
  config: Pick<ValidatedModalSandboxConfig, "defaultTimeoutMs">,
): SandboxCreateParams {
  return {
    command: [...ModalDefaultSandboxCommand],
    timeoutMs: resolveModalSandboxTimeoutMs(config),
    ...(request.sandboxInstanceId === undefined ? {} : { name: request.sandboxInstanceId }),
    ...(request.env === undefined ? {} : { env: withRequiredSandboxRuntimeEnv(request.env) }),
    ...(request.resources === undefined
      ? {}
      : {
          cpu: request.resources.vcpuCount,
          memoryMiB: request.resources.memoryMb,
        }),
  };
}

export function createModalSdkClient(config: ModalSandboxConfig): ModalClient {
  return new ModalClient({
    tokenId: config.tokenId,
    tokenSecret: config.tokenSecret,
    ...(config.environment === undefined ? {} : { environment: config.environment }),
  });
}

export function resolveModalSandboxTimeoutMs(
  config: Pick<ValidatedModalSandboxConfig, "defaultTimeoutMs">,
): number {
  return config.defaultTimeoutMs ?? ModalDefaultSandboxTimeoutMs;
}

export function isModalNotFound(error: unknown): boolean {
  return error instanceof ModalClientError && error.code === ModalClientErrorCodes.NOT_FOUND;
}
