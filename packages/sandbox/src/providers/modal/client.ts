import type { App } from "modal";
import { ModalClient as ModalSdkClient } from "modal";

import {
  ModalClientOperationIds,
  mapModalClientError,
  type ModalClientOperation,
} from "./client-errors.js";
import {
  ModalSnapshotSandboxRequestSchema,
  ModalStartSandboxRequestSchema,
  ModalStopSandboxRequestSchema,
  type ModalSandboxConfig,
  type ModalSnapshotSandboxRequest,
  type ModalStartSandboxRequest,
  type ModalStopSandboxRequest,
} from "./schemas.js";

export type ModalStartSandboxResponse = {
  sandboxId: string;
};

export type ModalSnapshotSandboxResponse = {
  imageId: string;
  createdAt: string;
};

export interface ModalClient {
  startSandbox(request: ModalStartSandboxRequest): Promise<ModalStartSandboxResponse>;
  snapshotSandbox(request: ModalSnapshotSandboxRequest): Promise<ModalSnapshotSandboxResponse>;
  stopSandbox(request: ModalStopSandboxRequest): Promise<void>;
}

export class ModalApiClient implements ModalClient {
  readonly #config: ModalSandboxConfig;
  readonly #modalClient: ModalSdkClient;
  #appPromise: Promise<App> | undefined;

  constructor(config: ModalSandboxConfig) {
    this.#config = config;
    this.#modalClient = new ModalSdkClient({
      tokenId: config.tokenId,
      tokenSecret: config.tokenSecret,
      ...(config.environmentName === undefined ? {} : { environment: config.environmentName }),
    });
  }

  async startSandbox(request: ModalStartSandboxRequest): Promise<ModalStartSandboxResponse> {
    const parsedRequest = ModalStartSandboxRequestSchema.parse(request);

    const app = await this.#getApp();
    const image = await this.#runModalClientOperation(ModalClientOperationIds.RESOLVE_IMAGE, () =>
      this.#modalClient.images.fromId(parsedRequest.imageId),
    );
    const sandbox = await this.#runModalClientOperation(ModalClientOperationIds.START_SANDBOX, () =>
      this.#modalClient.sandboxes.create(app, image),
    );

    return {
      sandboxId: sandbox.sandboxId,
    };
  }

  async snapshotSandbox(
    request: ModalSnapshotSandboxRequest,
  ): Promise<ModalSnapshotSandboxResponse> {
    const parsedRequest = ModalSnapshotSandboxRequestSchema.parse(request);

    const sandbox = await this.#runModalClientOperation(
      ModalClientOperationIds.RESOLVE_SANDBOX,
      () => this.#modalClient.sandboxes.fromId(parsedRequest.sandboxId),
    );
    const image = await this.#runModalClientOperation(
      ModalClientOperationIds.SNAPSHOT_SANDBOX,
      () => sandbox.snapshotFilesystem(),
    );

    return {
      imageId: image.imageId,
      // Modal does not return a snapshot creation timestamp from this SDK call.
      createdAt: new Date().toISOString(),
    };
  }

  async stopSandbox(request: ModalStopSandboxRequest): Promise<void> {
    const parsedRequest = ModalStopSandboxRequestSchema.parse(request);

    const sandbox = await this.#runModalClientOperation(
      ModalClientOperationIds.RESOLVE_SANDBOX,
      () => this.#modalClient.sandboxes.fromId(parsedRequest.sandboxId),
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
}
