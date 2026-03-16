import type { App, ModalWriteStream } from "modal";
import { ModalClient as ModalSdkClient } from "modal";

import {
  ModalClientOperationIds,
  mapModalClientError,
  type ModalClientOperation,
} from "./client-errors.js";
import {
  ModalCloseSandboxStdinRequestSchema,
  ModalStartSandboxRequestSchema,
  ModalStopSandboxRequestSchema,
  ModalWriteSandboxStdinRequestSchema,
  type ModalCloseSandboxStdinRequest,
  type ModalSandboxConfig,
  type ModalStartSandboxRequest,
  type ModalStopSandboxRequest,
  type ModalWriteSandboxStdinRequest,
} from "./schemas.js";

export type ModalStartSandboxResponse = {
  sandboxId: string;
};

export interface ModalClient {
  startSandbox(request: ModalStartSandboxRequest): Promise<ModalStartSandboxResponse>;
  writeSandboxStdin(request: ModalWriteSandboxStdinRequest): Promise<void>;
  closeSandboxStdin(request: ModalCloseSandboxStdinRequest): Promise<void>;
  stopSandbox(request: ModalStopSandboxRequest): Promise<void>;
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

  async startSandbox(request: ModalStartSandboxRequest): Promise<ModalStartSandboxResponse> {
    const parsedRequest = ModalStartSandboxRequestSchema.parse(request);

    const app = await this.#getApp();
    const image = await this.#runModalClientOperation(ModalClientOperationIds.RESOLVE_IMAGE, () =>
      this.#modalClient.images.fromId(parsedRequest.imageId),
    );
    const createParams = parsedRequest.env === undefined ? undefined : { env: parsedRequest.env };
    const sandbox = await this.#runModalClientOperation(ModalClientOperationIds.START_SANDBOX, () =>
      this.#modalClient.sandboxes.create(app, image, createParams),
    );

    return {
      sandboxId: sandbox.sandboxId,
    };
  }

  async writeSandboxStdin(request: ModalWriteSandboxStdinRequest): Promise<void> {
    const parsedRequest = ModalWriteSandboxStdinRequestSchema.parse(request);
    const stdinStream = await this.#getOrCreateSandboxStdinStream(parsedRequest.sandboxId);

    await this.#runModalClientOperation(ModalClientOperationIds.WRITE_STDIN, () =>
      stdinStream.writeBytes(new Uint8Array(parsedRequest.payload)),
    );
  }

  async closeSandboxStdin(request: ModalCloseSandboxStdinRequest): Promise<void> {
    const parsedRequest = ModalCloseSandboxStdinRequestSchema.parse(request);
    const stdinStream = await this.#getOrCreateSandboxStdinStream(parsedRequest.sandboxId);
    const stdinWriter = stdinStream.getWriter();

    try {
      await this.#runModalClientOperation(ModalClientOperationIds.CLOSE_STDIN, () =>
        stdinWriter.close(),
      );
      this.#stdinStreams.delete(parsedRequest.sandboxId);
    } finally {
      stdinWriter.releaseLock();
    }
  }

  async stopSandbox(request: ModalStopSandboxRequest): Promise<void> {
    const parsedRequest = ModalStopSandboxRequestSchema.parse(request);
    this.#stdinStreams.delete(parsedRequest.sandboxId);

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

  async #getOrCreateSandboxStdinStream(sandboxId: string): Promise<ModalWriteStream<string>> {
    const existingStdinStream = this.#stdinStreams.get(sandboxId);
    if (existingStdinStream !== undefined) {
      return existingStdinStream;
    }

    const sandbox = await this.#runModalClientOperation(
      ModalClientOperationIds.RESOLVE_SANDBOX,
      () => this.#modalClient.sandboxes.fromId(sandboxId),
    );
    const stdinStream = sandbox.stdin;
    this.#stdinStreams.set(sandboxId, stdinStream);

    return stdinStream;
  }
}
