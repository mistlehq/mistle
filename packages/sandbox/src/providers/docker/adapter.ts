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
    const id = response.runtimeId;

    return {
      provider: SandboxProvider.DOCKER,
      id,
    };
  }

  async resume(request: SandboxResumeRequestV1): Promise<SandboxHandle> {
    if (request.id.trim().length === 0) {
      throw new SandboxConfigurationError("Previous runtime id is required.");
    }

    const response = await this.#client.resumeSandbox({
      runtimeId: request.id,
    });
    const id = response.runtimeId;

    return {
      provider: SandboxProvider.DOCKER,
      id,
    };
  }

  async stop(request: SandboxStopRequest): Promise<void> {
    if (request.id.trim().length === 0) {
      throw new SandboxConfigurationError("Runtime id is required.");
    }

    try {
      await this.#client.stopSandbox({ runtimeId: request.id });
    } catch (error) {
      if (error instanceof DockerClientError && error.code === DockerClientErrorCodes.NOT_FOUND) {
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
      await this.#client.destroySandbox({ runtimeId: request.id });
    } catch (error) {
      if (error instanceof DockerClientError && error.code === DockerClientErrorCodes.NOT_FOUND) {
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

export function createDockerSandboxAdapter(input: { client: DockerClient }): SandboxAdapter {
  if (input.client === undefined) {
    throw new SandboxProviderNotImplementedError("Docker client is required to construct adapter.");
  }

  return new DockerSandboxAdapter(input.client);
}
