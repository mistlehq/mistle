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
  FreestyleClientError,
  FreestyleClientErrorCodes,
  FreestyleClientOperationIds,
} from "./client-errors.js";
import type { FreestyleClient } from "./client.js";
import { createFreestyleSnapshotImageHandle, parseFreestyleImageHandle } from "./image-handle.js";
import { createFreestyleTransparentProxyConfiguration } from "./transparent-proxy.js";
import type { FreestyleSandboxInspectResult } from "./types.js";

function createSandboxHandle(vmId: string): SandboxHandle {
  return { provider: SandboxProvider.FREESTYLE, id: vmId };
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

export class FreestyleSandboxAdapter implements SandboxAdapter {
  readonly #client: FreestyleClient;
  readonly #idleTimeoutSeconds: number | undefined;

  constructor(input: { client: FreestyleClient; idleTimeoutSeconds?: number }) {
    this.#client = input.client;
    this.#idleTimeoutSeconds = input.idleTimeoutSeconds;
  }

  getTransparentProxyConfiguration(): SandboxTransparentProxyConfiguration {
    return createFreestyleTransparentProxyConfiguration();
  }

  async prepareImage(request: SandboxPrepareImageRequest): Promise<SandboxImageHandle> {
    const image = parseFreestyleImageHandle(request.image);
    const response = await this.#client.prepareImage({ snapshotId: image.snapshotId });
    return createFreestyleSnapshotImageHandle(response.snapshotId);
  }

  async start(request: SandboxStartRequest): Promise<SandboxHandle> {
    const image = parseFreestyleImageHandle(request.image);
    const response = await this.#client.startSandbox({
      ...(request.sandboxInstanceId === undefined
        ? {}
        : { sandboxInstanceId: request.sandboxInstanceId }),
      snapshotId: image.snapshotId,
      ...(request.env === undefined ? {} : { env: request.env }),
      ...(this.#idleTimeoutSeconds === undefined
        ? {}
        : { idleTimeoutSeconds: this.#idleTimeoutSeconds }),
      ...(request.resources === undefined ? {} : { resources: request.resources }),
    });
    return createSandboxHandle(response.vmId);
  }

  async inspect(request: SandboxInspectRequest): Promise<FreestyleSandboxInspectResult> {
    requireSandboxId(request.id);

    try {
      return await this.#client.inspectSandbox({ vmId: request.id });
    } catch (error) {
      if (isFreestyleNotFound(error)) {
        throw toSandboxNotFoundError(request.id, error);
      }
      throw error;
    }
  }

  async resume(request: SandboxResumeRequestV1): Promise<SandboxHandle> {
    requireSandboxId(request.id);

    return await withSandboxProviderOperationTelemetry({
      provider: "freestyle",
      operation: FreestyleClientOperationIds.RESUME_SANDBOX,
      fn: async () => {
        try {
          const sandbox = await this.#client.resumeSandbox({ vmId: request.id });
          return createSandboxHandle(sandbox.vmId);
        } catch (error) {
          if (isFreestyleNotFound(error)) {
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
        vmId: request.id,
        ...(request.providerRequestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: request.providerRequestTimeoutMs }),
      });
      return createFreestyleSnapshotImageHandle(response.snapshotId);
    } catch (error) {
      if (isFreestyleNotFound(error)) {
        throw toSandboxNotFoundError(request.id, error);
      }
      throw error;
    }
  }

  async stop(request: SandboxStopRequest): Promise<void> {
    requireSandboxId(request.id);

    try {
      await this.#client.stopSandbox({ vmId: request.id });
    } catch (error) {
      if (isFreestyleNotFound(error)) {
        throw toSandboxNotFoundError(request.id, error);
      }
      throw error;
    }
  }

  async destroy(request: SandboxDestroyRequest): Promise<void> {
    requireSandboxId(request.id);

    try {
      await this.#client.destroySandbox({ vmId: request.id });
    } catch (error) {
      if (isFreestyleNotFound(error)) {
        throw toSandboxNotFoundError(request.id, error);
      }
      throw error;
    }
  }
}

export function createFreestyleSandboxAdapter(input: {
  client: FreestyleClient;
  idleTimeoutSeconds?: number;
}): FreestyleSandboxAdapter {
  if (input.client === undefined) {
    throw new SandboxProviderNotImplementedError(
      "Freestyle client is required to construct adapter.",
    );
  }
  return new FreestyleSandboxAdapter(input);
}

function isFreestyleNotFound(error: unknown): boolean {
  return (
    error instanceof FreestyleClientError && error.code === FreestyleClientErrorCodes.NOT_FOUND
  );
}
