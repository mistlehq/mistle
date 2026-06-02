import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import {
  SandboxProvider,
  type SandboxAdapter,
  type SandboxCaptureSnapshotRequest,
  type SandboxDestroyRequest,
  type SandboxHandle,
  type SandboxImageHandle,
  type SandboxInspectRequest,
  type SandboxPrepareImageRequest,
  type SandboxResumeRequestV1,
  type SandboxStartRequest,
  type SandboxStopRequest,
  type SandboxTransparentProxyConfiguration,
} from "../../types.js";
import { withSandboxProviderOperationTelemetry } from "../telemetry.js";
import { E2BClientError, E2BClientErrorCodes } from "./client-errors.js";
import type { E2BClient } from "./client.js";
import { createE2BTransparentProxyConfiguration } from "./transparent-proxy.js";
import type { E2BSandboxInspectResult } from "./types.js";

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

export class E2BSandboxAdapter implements SandboxAdapter {
  readonly #client: E2BClient;

  constructor(client: E2BClient) {
    this.#client = client;
  }

  getTransparentProxyConfiguration(): SandboxTransparentProxyConfiguration {
    return createE2BTransparentProxyConfiguration();
  }

  async prepareImage(request: SandboxPrepareImageRequest): Promise<SandboxImageHandle> {
    if (request.image.provider !== SandboxProvider.E2B) {
      throw new SandboxConfigurationError("E2B adapter received a non-E2B image handle.");
    }

    const response = await this.#client.prepareImage({
      imageRef: request.image.imageId,
    });

    return createSandboxImageHandle(response.imageRef);
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

    return await withSandboxProviderOperationTelemetry({
      provider: "e2b",
      operation: "resume_sandbox",
      fn: async () => {
        try {
          const sandbox = await this.#client.resumeSandbox({ sandboxId: request.id });
          return createSandboxHandle(sandbox.sandboxId);
        } catch (error) {
          if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
            throw toSandboxNotFoundError(request.id, error);
          }

          throw error;
        }
      },
    });
  }

  async captureSnapshot(request: SandboxCaptureSnapshotRequest): Promise<SandboxImageHandle> {
    requireSandboxId(request.id);

    try {
      const response = await this.#client.captureSandboxSnapshot({
        sandboxId: request.id,
        ...(request.providerRequestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: request.providerRequestTimeoutMs }),
      });

      return createSandboxImageHandle(response.snapshotId);
    } catch (error) {
      if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
        throw toSandboxNotFoundError(request.id, error);
      }

      throw error;
    }
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
