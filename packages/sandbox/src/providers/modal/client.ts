import { ModalClient, type App, type Image, type Sandbox, type SandboxCreateParams } from "modal";

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
    timeoutMs?: number;
  }): Promise<ModalRunCommandResponse>;
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
      const sandbox = await this.#client.sandboxes.create(app, image, {
        command: [...ModalDefaultSandboxCommand],
        experimentalOptions: ModalVmRuntimeExperimentalOptions,
        ...(this.#config.defaultTimeoutMs === undefined
          ? {}
          : { timeoutMs: this.#config.defaultTimeoutMs }),
        ...(parsedRequest.sandboxInstanceId === undefined
          ? {}
          : {
              name: parsedRequest.sandboxInstanceId,
              tags: {
                mistle_sandbox_instance_id: parsedRequest.sandboxInstanceId,
              },
            }),
        ...(parsedRequest.env === undefined
          ? {}
          : { env: withRequiredSandboxRuntimeEnv(parsedRequest.env) }),
        ...(parsedRequest.resources === undefined
          ? {}
          : {
              cpu: parsedRequest.resources.vcpuCount,
              memoryMiB: parsedRequest.resources.memoryMb,
            }),
      } satisfies SandboxCreateParams);
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
    const sandbox = await this.#client.sandboxes.fromId(parsedRequest.sandboxId);

    try {
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
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      });
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
    timeoutMs?: number;
  }): Promise<ModalRunCommandResponse> {
    const process = await input.sandbox.exec([...input.command], {
      mode: "text",
      ...(input.env === undefined ? {} : { env: withRequiredSandboxRuntimeEnv(input.env) }),
      ...(input.workingDir === undefined ? {} : { workdir: input.workingDir }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });
    const exitCode = await process.wait();
    const stdout = await process.stdout.readText();
    const stderr = await process.stderr.readText();
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

export function createModalSdkClient(config: ModalSandboxConfig): ModalClient {
  return new ModalClient({
    tokenId: config.tokenId,
    tokenSecret: config.tokenSecret,
    ...(config.environment === undefined ? {} : { environment: config.environment }),
  });
}

export function isModalNotFound(error: unknown): boolean {
  return error instanceof ModalClientError && error.code === ModalClientErrorCodes.NOT_FOUND;
}
