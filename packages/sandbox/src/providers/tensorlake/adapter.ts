import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import {
  SandboxProvider,
  SandboxStorageBackend,
  type SandboxAdapter,
  type SandboxArchilStorageAttachment,
  type SandboxArchilStorageCleanup,
  type SandboxAttachStorageRequest,
  type SandboxCaptureSnapshotRequest,
  type SandboxCleanupStorageRequest,
  type SandboxDestroyRequest,
  type SandboxHandle,
  type SandboxImageHandle,
  type SandboxInspectRequest,
  type SandboxPrepareImageRequest,
  type SandboxPrepareStorageForStartRequest,
  type SandboxResumeRequestV1,
  type SandboxStartRequest,
  type SandboxStartStoragePreparation,
  type SandboxStopRequest,
  type SandboxTransparentProxyConfiguration,
} from "../../types.js";
import { createE2BAttachStorageCommand, createE2BCleanupStorageCommand } from "../e2b/storage.js";
import {
  TensorlakeClientError,
  TensorlakeClientErrorCodes,
  TensorlakeClientOperationIds,
} from "./client-errors.js";
import type { TensorlakeClient } from "./client.js";
import {
  createTensorlakeRegisteredImageHandle,
  createTensorlakeSnapshotImageHandle,
  resolveTensorlakeStartImage,
} from "./image-handle.js";
import { createTensorlakeTransparentProxyConfiguration } from "./transparent-proxy.js";
import type { TensorlakeSandboxInspectResult } from "./types.js";

const ArchilMountTokenEnv = "ARCHIL_MOUNT_TOKEN";
const TensorlakeAttachStorageCommandTimeoutMs = 2 * 60 * 1000;
const TensorlakeCleanupStorageCommandTimeoutMs = 5 * 60 * 1000;

function createSandboxHandle(sandboxId: string): SandboxHandle {
  return { provider: SandboxProvider.TENSORLAKE, id: sandboxId };
}

function requireSandboxId(id: string): void {
  if (id.trim().length === 0) {
    throw new SandboxConfigurationError("Sandbox id is required.");
  }
}

function toSandboxNotFoundError(resourceId: string, error: unknown): SandboxResourceNotFoundError {
  return new SandboxResourceNotFoundError({
    resourceType: "sandbox",
    resourceId,
    cause: error,
  });
}

function requireArchilStorageAttachment(
  request: SandboxAttachStorageRequest,
): SandboxArchilStorageAttachment {
  if (request.storage.backend !== SandboxStorageBackend.ARCHIL) {
    throw new SandboxConfigurationError(
      "Tensorlake adapter expected an Archil storage attachment.",
    );
  }
  return request.storage;
}

function requireArchilStorageCleanup(
  request: SandboxCleanupStorageRequest,
): SandboxArchilStorageCleanup {
  if (request.storage.backend !== SandboxStorageBackend.ARCHIL) {
    throw new SandboxConfigurationError(
      "Tensorlake adapter expected an Archil storage cleanup payload.",
    );
  }
  return request.storage;
}

export class TensorlakeSandboxAdapter implements SandboxAdapter {
  readonly #client: TensorlakeClient;

  constructor(client: TensorlakeClient) {
    this.#client = client;
  }

  getTransparentProxyConfiguration(): SandboxTransparentProxyConfiguration {
    return createTensorlakeTransparentProxyConfiguration();
  }

  async prepareImage(request: SandboxPrepareImageRequest): Promise<SandboxImageHandle> {
    const image = resolveTensorlakeStartImage(request.image);
    await this.#client.prepareImage({ image });

    if (image.kind === "image" && image.sourceBaseImageRef !== undefined) {
      return createTensorlakeRegisteredImageHandle(image.id);
    }

    return request.image;
  }

  async prepareStorageForStart(
    _request: SandboxPrepareStorageForStartRequest,
  ): Promise<SandboxStartStoragePreparation> {
    return {};
  }

  async start(request: SandboxStartRequest): Promise<SandboxHandle> {
    if (request.sandboxInstanceId === undefined) {
      throw new SandboxConfigurationError(
        "Tensorlake adapter requires a sandbox instance id to create a named sandbox.",
      );
    }
    const image = resolveTensorlakeStartImage(request.image);
    const response = await this.#client.startSandbox({
      sandboxInstanceId: request.sandboxInstanceId,
      image,
      ...(request.env === undefined ? {} : { env: request.env }),
      ...(request.resources === undefined ? {} : { resources: request.resources }),
    });
    return createSandboxHandle(response.sandboxId);
  }

  async inspect(request: SandboxInspectRequest): Promise<TensorlakeSandboxInspectResult> {
    requireSandboxId(request.id);

    try {
      return await this.#client.inspectSandbox({ sandboxId: request.id });
    } catch (error) {
      if (
        error instanceof TensorlakeClientError &&
        error.code === TensorlakeClientErrorCodes.NOT_FOUND
      ) {
        throw toSandboxNotFoundError(request.id, error);
      }
      throw error;
    }
  }

  async resume(request: SandboxResumeRequestV1): Promise<SandboxHandle> {
    requireSandboxId(request.id);

    try {
      const sandbox = await this.#client.resumeSandbox({ sandboxId: request.id });
      return createSandboxHandle(sandbox.sandboxId);
    } catch (error) {
      if (
        error instanceof TensorlakeClientError &&
        error.code === TensorlakeClientErrorCodes.NOT_FOUND
      ) {
        throw toSandboxNotFoundError(request.id, error);
      }
      throw error;
    }
  }

  async captureSnapshot(request: SandboxCaptureSnapshotRequest) {
    requireSandboxId(request.id);

    try {
      const response = await this.#client.captureSandboxSnapshot({ sandboxId: request.id });
      return createTensorlakeSnapshotImageHandle(response.snapshotId);
    } catch (error) {
      if (
        error instanceof TensorlakeClientError &&
        error.code === TensorlakeClientErrorCodes.NOT_FOUND
      ) {
        throw toSandboxNotFoundError(request.id, error);
      }
      throw error;
    }
  }

  async attachStorage(request: SandboxAttachStorageRequest): Promise<void> {
    const storage = requireArchilStorageAttachment(request);

    await this.#client.runCommand({
      sandboxId: request.sandbox.id,
      command: createE2BAttachStorageCommand({ lifecycle: request.lifecycle, storage }),
      operation: TensorlakeClientOperationIds.RUN_COMMAND,
      commandDescription: "Tensorlake sandbox storage attach command",
      env: { [ArchilMountTokenEnv]: storage.credential },
      workingDir: "/",
      timeoutMs: TensorlakeAttachStorageCommandTimeoutMs,
    });
  }

  async cleanupStorage(request: SandboxCleanupStorageRequest): Promise<void> {
    const storage = requireArchilStorageCleanup(request);
    const command = createE2BCleanupStorageCommand({ request: { ...request, storage } });

    if (command === null) {
      return;
    }

    await this.#client.runCommand({
      sandboxId: request.sandbox.id,
      command,
      operation: TensorlakeClientOperationIds.RUN_COMMAND,
      commandDescription: "Tensorlake sandbox storage cleanup command",
      workingDir: "/",
      timeoutMs: TensorlakeCleanupStorageCommandTimeoutMs,
    });
  }

  async stop(request: SandboxStopRequest): Promise<void> {
    requireSandboxId(request.id);

    try {
      await this.#client.stopSandbox({ sandboxId: request.id });
    } catch (error) {
      if (
        error instanceof TensorlakeClientError &&
        error.code === TensorlakeClientErrorCodes.NOT_FOUND
      ) {
        throw toSandboxNotFoundError(request.id, error);
      }
      throw error;
    }
  }

  async destroy(request: SandboxDestroyRequest): Promise<void> {
    requireSandboxId(request.id);

    try {
      await this.#client.destroySandbox({ sandboxId: request.id });
    } catch (error) {
      if (
        error instanceof TensorlakeClientError &&
        error.code === TensorlakeClientErrorCodes.NOT_FOUND
      ) {
        throw toSandboxNotFoundError(request.id, error);
      }
      throw error;
    }
  }
}

export function createTensorlakeSandboxAdapter(input: {
  client: TensorlakeClient;
}): TensorlakeSandboxAdapter {
  if (input.client === undefined) {
    throw new SandboxProviderNotImplementedError(
      "Tensorlake client is required to construct adapter.",
    );
  }
  return new TensorlakeSandboxAdapter(input.client);
}
