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
  OpenComputerClientError,
  OpenComputerClientErrorCodes,
  OpenComputerClientOperationIds,
} from "./client-errors.js";
import type { OpenComputerClient } from "./client.js";
import {
  createOpenComputerCheckpointImageHandle,
  createOpenComputerSnapshotImageHandle,
  resolveOpenComputerStartImage,
} from "./image-handle.js";
import type { ValidatedOpenComputerSandboxConfig } from "./schemas.js";
import { createOpenComputerTransparentProxyConfiguration } from "./transparent-proxy.js";
import type { OpenComputerSandboxInspectResult } from "./types.js";

function createSandboxHandle(sandboxId: string): SandboxHandle {
  return { provider: SandboxProvider.OPENCOMPUTER, id: sandboxId };
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

function isOpenComputerNotFound(error: unknown): boolean {
  return (
    error instanceof OpenComputerClientError &&
    error.code === OpenComputerClientErrorCodes.NOT_FOUND
  );
}

export class OpenComputerSandboxAdapter implements SandboxAdapter {
  readonly #client: OpenComputerClient;
  readonly #sandboxd: ValidatedOpenComputerSandboxConfig["sandboxd"] | undefined;

  constructor(input: {
    client: OpenComputerClient;
    sandboxd?: ValidatedOpenComputerSandboxConfig["sandboxd"];
  }) {
    this.#client = input.client;
    this.#sandboxd = input.sandboxd;
  }

  getTransparentProxyConfiguration(): SandboxTransparentProxyConfiguration {
    return createOpenComputerTransparentProxyConfiguration();
  }

  async prepareImage(request: SandboxPrepareImageRequest): Promise<SandboxImageHandle> {
    const image = resolveOpenComputerStartImage(request.image, { sandboxd: this.#sandboxd });
    try {
      const response = await this.#client.prepareImage({ image });
      if (response.image.kind === "snapshot") {
        return createOpenComputerSnapshotImageHandle(response.image.id);
      }
      return request.image;
    } catch (error) {
      if (isOpenComputerNotFound(error)) {
        throw new SandboxResourceNotFoundError({
          resourceType: "image",
          resourceId: request.image.imageId,
          cause: error,
        });
      }
      throw error;
    }
  }

  async start(request: SandboxStartRequest): Promise<SandboxHandle> {
    const image = resolveOpenComputerStartImage(request.image, { sandboxd: this.#sandboxd });
    const response = await this.#client.startSandbox({
      ...(request.sandboxInstanceId === undefined
        ? {}
        : { sandboxInstanceId: request.sandboxInstanceId }),
      image,
      ...(request.env === undefined ? {} : { env: request.env }),
      ...(request.resources === undefined ? {} : { resources: request.resources }),
    });
    return createSandboxHandle(response.sandboxId);
  }

  async inspect(request: SandboxInspectRequest): Promise<OpenComputerSandboxInspectResult> {
    requireSandboxId(request.id);

    try {
      return await this.#client.inspectSandbox({ sandboxId: request.id });
    } catch (error) {
      if (isOpenComputerNotFound(error)) {
        throw toSandboxNotFoundError(request.id, error);
      }
      throw error;
    }
  }

  async resume(request: SandboxResumeRequestV1): Promise<SandboxHandle> {
    requireSandboxId(request.id);

    return await withSandboxProviderOperationTelemetry({
      provider: "opencomputer",
      operation: OpenComputerClientOperationIds.RESUME_SANDBOX,
      fn: async () => {
        try {
          const sandbox = await this.#client.resumeSandbox({ sandboxId: request.id });
          return createSandboxHandle(sandbox.sandboxId);
        } catch (error) {
          if (isOpenComputerNotFound(error)) {
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
        name: createOpenComputerCheckpointName(request.id),
        ...(request.providerRequestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: request.providerRequestTimeoutMs }),
      });
      return createOpenComputerCheckpointImageHandle(response.checkpointId);
    } catch (error) {
      if (isOpenComputerNotFound(error)) {
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
      if (isOpenComputerNotFound(error)) {
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
      if (isOpenComputerNotFound(error)) {
        throw toSandboxNotFoundError(request.id, error);
      }
      throw error;
    }
  }
}

function createOpenComputerCheckpointName(sandboxId: string): string {
  return `mistle-${sandboxId}`;
}

export function createOpenComputerSandboxAdapter(input: {
  client: OpenComputerClient;
  sandboxd?: ValidatedOpenComputerSandboxConfig["sandboxd"];
}): OpenComputerSandboxAdapter {
  if (input.client === undefined) {
    throw new SandboxProviderNotImplementedError(
      "OpenComputer client is required to construct adapter.",
    );
  }
  return new OpenComputerSandboxAdapter({
    client: input.client,
    ...(input.sandboxd === undefined ? {} : { sandboxd: input.sandboxd }),
  });
}
