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
  type SandboxPrepareStorageForStartRequest,
  type SandboxResumeRequestV1,
  type SandboxStartStoragePreparation,
  type SandboxStartRequest,
  type SandboxStopRequest,
} from "../../types.js";
import { E2BClientError, E2BClientErrorCodes, E2BClientOperationIds } from "./client-errors.js";
import type { E2BClient } from "./client.js";
import { createE2BAttachStorageCommand, createE2BCleanupStorageCommand } from "./storage.js";
import type { E2BSandboxInspectResult } from "./types.js";

const ArchilMountTokenEnv = "ARCHIL_MOUNT_TOKEN";
const E2BAttachStorageCommandTimeoutMs = 2 * 60 * 1000;
const E2BCleanupStorageCommandTimeoutMs = 5 * 60 * 1000;

function createSandboxHandle(sandboxId: string): SandboxHandle {
  return {
    provider: SandboxProvider.E2B,
    id: sandboxId,
  };
}

function createSandboxImageHandle(imageId: string): SandboxImageHandle {
  return {
    provider: SandboxProvider.E2B,
    imageId,
    createdAt: new Date().toISOString(),
  };
}

function toSandboxNotFoundError(resourceId: string, error: unknown): SandboxResourceNotFoundError {
  return new SandboxResourceNotFoundError({
    resourceType: "sandbox",
    resourceId,
    cause: error,
  });
}

function requireSandboxId(id: string): void {
  if (id.trim().length === 0) {
    throw new SandboxConfigurationError("Sandbox id is required.");
  }
}

function requireArchilStorageAttachment(
  request: SandboxAttachStorageRequest,
): SandboxArchilStorageAttachment {
  if (request.storage.backend !== SandboxStorageBackend.ARCHIL) {
    throw new SandboxConfigurationError("E2B adapter expected an Archil storage attachment.");
  }

  return request.storage;
}

function requireArchilStorageCleanup(
  request: SandboxCleanupStorageRequest,
): SandboxArchilStorageCleanup {
  if (request.storage.backend !== SandboxStorageBackend.ARCHIL) {
    throw new SandboxConfigurationError("E2B adapter expected an Archil storage cleanup payload.");
  }

  return request.storage;
}

export class E2BSandboxAdapter implements SandboxAdapter {
  readonly #client: E2BClient;

  constructor(client: E2BClient) {
    this.#client = client;
  }

  async prepareStorageForStart(
    _request: SandboxPrepareStorageForStartRequest,
  ): Promise<SandboxStartStoragePreparation> {
    return {};
  }

  async start(request: SandboxStartRequest): Promise<SandboxHandle> {
    if (request.image.provider !== SandboxProvider.E2B) {
      throw new SandboxConfigurationError("E2B adapter received a non-E2B image handle.");
    }

    const response = await this.#client.startSandbox({
      imageRef: request.image.imageId,
      ...(request.env === undefined ? {} : { env: request.env }),
    });

    return createSandboxHandle(response.sandboxId);
  }

  async inspect(request: SandboxInspectRequest): Promise<E2BSandboxInspectResult> {
    requireSandboxId(request.id);

    try {
      return await this.#client.inspectSandbox({ sandboxId: request.id });
    } catch (error) {
      if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
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
      if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
        throw toSandboxNotFoundError(request.id, error);
      }

      throw error;
    }
  }

  async captureSnapshot(request: SandboxCaptureSnapshotRequest): Promise<SandboxImageHandle> {
    requireSandboxId(request.id);

    try {
      const response = await this.#client.captureSandboxSnapshot({
        sandboxId: request.id,
      });

      return createSandboxImageHandle(response.snapshotId);
    } catch (error) {
      if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
        throw toSandboxNotFoundError(request.id, error);
      }

      throw error;
    }
  }

  async attachStorage(request: SandboxAttachStorageRequest): Promise<void> {
    const storage = requireArchilStorageAttachment(request);

    await this.#client.runCommand({
      sandboxId: request.sandbox.id,
      command: createE2BAttachStorageCommand({
        lifecycle: request.lifecycle,
        storage,
      }),
      operation: E2BClientOperationIds.ATTACH_STORAGE,
      commandDescription: "E2B sandbox storage attach command",
      env: {
        [ArchilMountTokenEnv]: storage.credential,
      },
      cwd: "/",
      timeoutMs: E2BAttachStorageCommandTimeoutMs,
      user: "root",
    });
  }

  async cleanupStorage(request: SandboxCleanupStorageRequest): Promise<void> {
    const storage = requireArchilStorageCleanup(request);

    const command = createE2BCleanupStorageCommand({
      request: {
        ...request,
        storage,
      },
    });

    if (command === null) {
      return;
    }

    await this.#client.runCommand({
      sandboxId: request.sandbox.id,
      command,
      operation: E2BClientOperationIds.CLEANUP_STORAGE,
      commandDescription: "E2B sandbox storage cleanup command",
      cwd: "/",
      timeoutMs: E2BCleanupStorageCommandTimeoutMs,
      user: "root",
    });
  }

  async stop(request: SandboxStopRequest): Promise<void> {
    requireSandboxId(request.id);

    try {
      await this.#client.stopSandbox({ sandboxId: request.id });
    } catch (error) {
      if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
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
      if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
        throw toSandboxNotFoundError(request.id, error);
      }

      throw error;
    }
  }
}

export function createE2BSandboxAdapter(input: { client: E2BClient }): E2BSandboxAdapter {
  if (input.client === undefined) {
    throw new SandboxProviderNotImplementedError("E2B client is required to construct adapter.");
  }

  return new E2BSandboxAdapter(input.client);
}
