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
import { ModalClientError, ModalClientErrorCodes } from "./client-errors.js";
import type { ModalClient } from "./client.js";

export class ModalSandboxAdapter implements SandboxAdapter {
  readonly #client: ModalClient;

  constructor(client: ModalClient) {
    this.#client = client;
  }

  async start(request: SandboxStartRequest): Promise<SandboxHandle> {
    if (request.image.provider !== SandboxProvider.MODAL) {
      throw new SandboxConfigurationError("Modal adapter received a non-Modal image handle.");
    }

    const response = await this.#client.startSandbox({
      imageId: request.image.imageId,
      ...(request.env === undefined ? {} : { env: request.env }),
    });
    const id = response.runtimeId;

    return {
      provider: SandboxProvider.MODAL,
      id,
      writeStdin: async (input) => {
        await this.#client.writeSandboxStdin({
          runtimeId: id,
          payload: input.payload,
        });
      },
      closeStdin: async () => {
        await this.#client.closeSandboxStdin({
          runtimeId: id,
        });
      },
    };
  }

  async resume(request: SandboxResumeRequestV1): Promise<SandboxHandle> {
    if (request.image.provider !== SandboxProvider.MODAL) {
      throw new SandboxConfigurationError("Modal adapter received a non-Modal image handle.");
    }

    const response = await this.#client.startSandbox({
      imageId: request.image.imageId,
      ...(request.env === undefined ? {} : { env: request.env }),
    });
    const id = response.runtimeId;

    return {
      provider: SandboxProvider.MODAL,
      id,
      writeStdin: async (input) => {
        await this.#client.writeSandboxStdin({
          runtimeId: id,
          payload: input.payload,
        });
      },
      closeStdin: async () => {
        await this.#client.closeSandboxStdin({
          runtimeId: id,
        });
      },
    };
  }

  async stop(request: SandboxStopRequest): Promise<void> {
    if (request.id.trim().length === 0) {
      throw new SandboxConfigurationError("Runtime id is required.");
    }

    try {
      await this.#client.stopSandbox({ runtimeId: request.id });
    } catch (error) {
      if (error instanceof ModalClientError && error.code === ModalClientErrorCodes.NOT_FOUND) {
        throw new SandboxResourceNotFoundError({
          resourceType: "sandbox",
          resourceId: request.id,
          cause: error,
        });
      }

      throw error;
    }
  }

  async destroy(request: SandboxDestroyRequest): Promise<void> {
    if (request.id.trim().length === 0) {
      throw new SandboxConfigurationError("Runtime id is required.");
    }

    try {
      await this.#client.stopSandbox({ runtimeId: request.id });
    } catch (error) {
      if (error instanceof ModalClientError && error.code === ModalClientErrorCodes.NOT_FOUND) {
        throw new SandboxResourceNotFoundError({
          resourceType: "sandbox",
          resourceId: request.id,
          cause: error,
        });
      }

      throw error;
    }
  }
}

export function createModalSandboxAdapter(input: { client: ModalClient }): SandboxAdapter {
  if (input.client === undefined) {
    throw new SandboxProviderNotImplementedError("Modal client is required to construct adapter.");
  }

  return new ModalSandboxAdapter(input.client);
}
