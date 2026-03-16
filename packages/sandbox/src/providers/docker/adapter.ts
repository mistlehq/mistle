import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import {
  SandboxProvider,
  type SandboxAdapter,
  type SandboxHandle,
  type SandboxStartRequest,
  type SandboxStopRequest,
} from "../../types.js";
import { DockerClientError, DockerClientErrorCodes } from "./client-errors.js";
import type { DockerClient } from "./client.js";

export class DockerSandboxAdapter implements SandboxAdapter {
  readonly #client: DockerClient;

  constructor(client: DockerClient) {
    this.#client = client;
  }

  async start(request: SandboxStartRequest): Promise<SandboxHandle> {
    if (request.image.provider !== SandboxProvider.DOCKER) {
      throw new SandboxConfigurationError("Docker adapter received a non-Docker image handle.");
    }

    const response = await this.#client.startSandbox({
      imageRef: request.image.imageId,
      ...(request.env === undefined ? {} : { env: request.env }),
    });
    const sandboxId = response.sandboxId;

    return {
      provider: SandboxProvider.DOCKER,
      sandboxId,
      writeStdin: async (input) => {
        await this.#client.writeSandboxStdin({
          sandboxId,
          payload: input.payload,
        });
      },
      closeStdin: async () => {
        await this.#client.closeSandboxStdin({
          sandboxId,
        });
      },
    };
  }

  async stop(request: SandboxStopRequest): Promise<void> {
    if (request.sandboxId.trim().length === 0) {
      throw new SandboxConfigurationError("Sandbox id is required.");
    }

    try {
      await this.#client.stopSandbox({ sandboxId: request.sandboxId });
    } catch (error) {
      if (error instanceof DockerClientError && error.code === DockerClientErrorCodes.NOT_FOUND) {
        throw new SandboxResourceNotFoundError({
          resourceType: "sandbox",
          resourceId: request.sandboxId,
          cause: error,
        });
      }

      throw error;
    }
  }
}

export function createDockerSandboxAdapter(input: { client: DockerClient }): SandboxAdapter {
  if (input.client === undefined) {
    throw new SandboxProviderNotImplementedError("Docker client is required to construct adapter.");
  }

  return new DockerSandboxAdapter(input.client);
}
