import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import {
  SandboxProvider,
  type SandboxAdapter,
  type SandboxDestroyRequest,
  type SandboxHandle,
  type SandboxResumeRequestV1,
  type SandboxStartRequest,
  type SandboxStopRequest,
} from "../../types.js";
import { E2BClientError, E2BClientErrorCodes } from "./client-errors.js";
import type { E2BClient } from "./client.js";

function createSandboxHandle(sandboxId: string): SandboxHandle {
  return {
    provider: SandboxProvider.E2B,
    id: sandboxId,
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

export function createE2BSandboxAdapter(input: { client: E2BClient }): SandboxAdapter {
  if (input.client === undefined) {
    throw new SandboxProviderNotImplementedError("E2B client is required to construct adapter.");
  }

  return new E2BSandboxAdapter(input.client);
}
