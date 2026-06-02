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

    return await withSandboxProviderOperationTelemetry({
      provider: "tensorlake",
      operation: TensorlakeClientOperationIds.RESUME_SANDBOX,
      fn: async () => {
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
      },
    });
  }

  async captureSnapshot(request: SandboxCaptureSnapshotRequest) {
    requireSandboxId(request.id);

    try {
      const response = await this.#client.captureSandboxSnapshot({
        sandboxId: request.id,
        ...(request.providerRequestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: request.providerRequestTimeoutMs }),
      });
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
