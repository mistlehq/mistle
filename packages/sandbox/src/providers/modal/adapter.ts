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
import { ModalClientOperationIds } from "./client-errors.js";
import { isModalNotFound, type ModalClientApi } from "./client.js";
import { createModalTransparentProxyConfiguration } from "./transparent-proxy.js";
import type { ModalSandboxInspectResult } from "./types.js";

function createSandboxHandle(sandboxId: string): SandboxHandle {
  return { provider: SandboxProvider.MODAL, id: sandboxId };
}

function createSandboxImageHandle(imageId: string): SandboxImageHandle {
  return {
    provider: SandboxProvider.MODAL,
    imageId,
    createdAt: new Date().toISOString(),
  };
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

export class ModalSandboxAdapter implements SandboxAdapter {
  readonly #client: ModalClientApi;

  constructor(client: ModalClientApi) {
    this.#client = client;
  }

  getTransparentProxyConfiguration(): SandboxTransparentProxyConfiguration {
    return createModalTransparentProxyConfiguration();
  }

  async prepareImage(request: SandboxPrepareImageRequest): Promise<SandboxImageHandle> {
    if (request.image.provider !== SandboxProvider.MODAL) {
      throw new SandboxConfigurationError("Modal adapter received a non-Modal image handle.");
    }

    const response = await this.#client.prepareImage({ imageId: request.image.imageId });
    return createSandboxImageHandle(response.imageId);
  }

  async start(request: SandboxStartRequest): Promise<SandboxHandle> {
    if (request.image.provider !== SandboxProvider.MODAL) {
      throw new SandboxConfigurationError("Modal adapter received a non-Modal image handle.");
    }

    const response = await this.#client.startSandbox({
      imageId: request.image.imageId,
      ...(request.sandboxInstanceId === undefined
        ? {}
        : { sandboxInstanceId: request.sandboxInstanceId }),
      ...(request.env === undefined ? {} : { env: request.env }),
      ...(request.resources === undefined ? {} : { resources: request.resources }),
    });
    return createSandboxHandle(response.sandboxId);
  }

  async inspect(request: SandboxInspectRequest): Promise<ModalSandboxInspectResult> {
    requireSandboxId(request.id);

    try {
      return await this.#client.inspectSandbox({ sandboxId: request.id });
    } catch (error) {
      if (isModalNotFound(error)) {
        throw toSandboxNotFoundError(request.id, error);
      }
      throw error;
    }
  }

  async resume(request: SandboxResumeRequestV1): Promise<SandboxHandle> {
    requireSandboxId(request.id);

    return await withSandboxProviderOperationTelemetry({
      provider: "modal",
      operation: ModalClientOperationIds.RESUME_SANDBOX,
      fn: () => {
        throw new SandboxProviderNotImplementedError(
          "Modal sandbox resume is not implemented. Modal reattachment does not restore a terminated sandbox from a saved Mistle snapshot.",
        );
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
      return createSandboxImageHandle(response.imageId);
    } catch (error) {
      if (isModalNotFound(error)) {
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
      if (isModalNotFound(error)) {
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
      if (isModalNotFound(error)) {
        throw toSandboxNotFoundError(request.id, error);
      }
      throw error;
    }
  }
}

export function createModalSandboxAdapter(input: { client: ModalClientApi }): ModalSandboxAdapter {
  if (input.client === undefined) {
    throw new SandboxProviderNotImplementedError("Modal client is required to construct adapter.");
  }
  return new ModalSandboxAdapter(input.client);
}
