import { randomUUID } from "node:crypto";

import type { App, ModalWriteStream, Volume } from "modal";
import { ModalClient as ModalSdkClient } from "modal";

import {
  ModalClientOperationIds,
  mapModalClientError,
  type ModalClientOperation,
} from "./client-errors.js";
import {
  ModalCloseSandboxStdinRequestSchema,
  ModalCreateVolumeRequestSchema,
  ModalDeleteVolumeRequestSchema,
  ModalStartSandboxRequestSchema,
  ModalStopSandboxRequestSchema,
  ModalWriteSandboxStdinRequestSchema,
  type ModalCloseSandboxStdinRequest,
  type ModalCreateVolumeRequest,
  type ModalDeleteVolumeRequest,
  type ModalSandboxConfig,
  type ModalStartSandboxRequest,
  type ModalStopSandboxRequest,
  type ModalVolumeMount,
  type ModalWriteSandboxStdinRequest,
} from "./schemas.js";

export type ModalStartSandboxResponse = {
  runtimeId: string;
};

export type ModalCreateVolumeResponse = {
  volumeId: string;
};

export interface ModalClient {
  createVolume(request: ModalCreateVolumeRequest): Promise<ModalCreateVolumeResponse>;
  deleteVolume(request: ModalDeleteVolumeRequest): Promise<void>;
  startSandbox(request: ModalStartSandboxRequest): Promise<ModalStartSandboxResponse>;
  writeSandboxStdin(request: ModalWriteSandboxStdinRequest): Promise<void>;
  closeSandboxStdin(request: ModalCloseSandboxStdinRequest): Promise<void>;
  stopSandbox(request: ModalStopSandboxRequest): Promise<void>;
}

function createModalVolumeName(): string {
  return `mistle-volume-${randomUUID().replaceAll("-", "")}`;
}

export class ModalApiClient implements ModalClient {
  readonly #config: ModalSandboxConfig;
  readonly #modalClient: ModalSdkClient;
  readonly #stdinStreams = new Map<string, ModalWriteStream<string>>();
  #appPromise: Promise<App> | undefined;

  constructor(config: ModalSandboxConfig) {
    this.#config = config;
    this.#modalClient = new ModalSdkClient({
      tokenId: config.tokenId,
      tokenSecret: config.tokenSecret,
      ...(config.environmentName === undefined ? {} : { environment: config.environmentName }),
    });
  }

  async createVolume(_request: ModalCreateVolumeRequest): Promise<ModalCreateVolumeResponse> {
    ModalCreateVolumeRequestSchema.parse(_request);

    const volumeId = createModalVolumeName();
    await this.#runModalClientOperation(ModalClientOperationIds.CREATE_VOLUME, () =>
      this.#modalClient.volumes.fromName(volumeId, {
        createIfMissing: true,
        ...(this.#config.environmentName === undefined
          ? {}
          : { environment: this.#config.environmentName }),
      }),
    );

    return {
      volumeId,
    };
  }

  async deleteVolume(request: ModalDeleteVolumeRequest): Promise<void> {
    const parsedRequest = ModalDeleteVolumeRequestSchema.parse(request);

    await this.#runModalClientOperation(ModalClientOperationIds.DELETE_VOLUME, () =>
      this.#modalClient.volumes.delete(parsedRequest.volumeId, {
        allowMissing: false,
        ...(this.#config.environmentName === undefined
          ? {}
          : { environment: this.#config.environmentName }),
      }),
    );
  }

  async startSandbox(request: ModalStartSandboxRequest): Promise<ModalStartSandboxResponse> {
    const parsedRequest = ModalStartSandboxRequestSchema.parse(request);

    const app = await this.#getApp();
    const image = await this.#runModalClientOperation(ModalClientOperationIds.RESOLVE_IMAGE, () =>
      this.#modalClient.images.fromId(parsedRequest.imageId),
    );
    const createParams = {
      ...(parsedRequest.env === undefined ? {} : { env: parsedRequest.env }),
      ...(parsedRequest.mounts === undefined || parsedRequest.mounts.length === 0
        ? {}
        : { volumes: await this.#resolveVolumesByMountPath(parsedRequest.mounts) }),
    };
    const sandbox = await this.#runModalClientOperation(ModalClientOperationIds.START_SANDBOX, () =>
      this.#modalClient.sandboxes.create(app, image, createParams),
    );

    return {
      runtimeId: sandbox.sandboxId,
    };
  }

  async writeSandboxStdin(request: ModalWriteSandboxStdinRequest): Promise<void> {
    const parsedRequest = ModalWriteSandboxStdinRequestSchema.parse(request);
    const stdinStream = await this.#getOrCreateSandboxStdinStream(parsedRequest.runtimeId);

    await this.#runModalClientOperation(ModalClientOperationIds.WRITE_STDIN, () =>
      stdinStream.writeBytes(new Uint8Array(parsedRequest.payload)),
    );
  }

  async closeSandboxStdin(request: ModalCloseSandboxStdinRequest): Promise<void> {
    const parsedRequest = ModalCloseSandboxStdinRequestSchema.parse(request);
    const stdinStream = await this.#getOrCreateSandboxStdinStream(parsedRequest.runtimeId);
    const stdinWriter = stdinStream.getWriter();

    try {
      await this.#runModalClientOperation(ModalClientOperationIds.CLOSE_STDIN, () =>
        stdinWriter.close(),
      );
      this.#stdinStreams.delete(parsedRequest.runtimeId);
    } finally {
      stdinWriter.releaseLock();
    }
  }

  async stopSandbox(request: ModalStopSandboxRequest): Promise<void> {
    const parsedRequest = ModalStopSandboxRequestSchema.parse(request);
    this.#stdinStreams.delete(parsedRequest.runtimeId);

    const sandbox = await this.#runModalClientOperation(
      ModalClientOperationIds.RESOLVE_SANDBOX,
      () => this.#modalClient.sandboxes.fromId(parsedRequest.runtimeId),
    );
    await this.#runModalClientOperation(ModalClientOperationIds.STOP_SANDBOX, () =>
      sandbox.terminate(),
    );
  }

  async #getApp(): Promise<App> {
    if (this.#appPromise !== undefined) {
      return this.#appPromise;
    }

    const appLookupOptions =
      this.#config.environmentName === undefined
        ? { createIfMissing: false }
        : { createIfMissing: false, environment: this.#config.environmentName };

    const appPromise = this.#runModalClientOperation(ModalClientOperationIds.RESOLVE_APP, () =>
      this.#modalClient.apps.fromName(this.#config.appName, appLookupOptions),
    );
    this.#appPromise = appPromise;

    try {
      return await appPromise;
    } catch (error) {
      if (this.#appPromise === appPromise) {
        this.#appPromise = undefined;
      }

      throw error;
    }
  }

  async #resolveVolumesByMountPath(
    mounts: ReadonlyArray<ModalVolumeMount>,
  ): Promise<Record<string, Volume>> {
    const entries = await Promise.all(
      mounts.map(async (mount) => {
        const volume = await this.#runModalClientOperation(
          ModalClientOperationIds.RESOLVE_VOLUME,
          () =>
            this.#modalClient.volumes.fromName(mount.volumeId, {
              createIfMissing: false,
              ...(this.#config.environmentName === undefined
                ? {}
                : { environment: this.#config.environmentName }),
            }),
        );

        return [mount.mountPath, volume] as const;
      }),
    );

    return Object.fromEntries(entries);
  }

  async #runModalClientOperation<TResult>(
    operation: ModalClientOperation,
    operationFn: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await operationFn();
    } catch (error) {
      throw mapModalClientError(operation, error);
    }
  }

  async #getOrCreateSandboxStdinStream(runtimeId: string): Promise<ModalWriteStream<string>> {
    const existingStdinStream = this.#stdinStreams.get(runtimeId);
    if (existingStdinStream !== undefined) {
      return existingStdinStream;
    }

    const sandbox = await this.#runModalClientOperation(
      ModalClientOperationIds.RESOLVE_SANDBOX,
      () => this.#modalClient.sandboxes.fromId(runtimeId),
    );
    const stdinStream = sandbox.stdin;
    this.#stdinStreams.set(runtimeId, stdinStream);

    return stdinStream;
  }
}
