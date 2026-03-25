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
  type CreateVolumeRequestV1,
  type DeleteVolumeRequestV1,
  type SandboxVolumeHandleV1,
} from "../../types.js";
import { DockerClientError, DockerClientErrorCodes } from "./client-errors.js";
import type { DockerClient } from "./client.js";

function createVolumeHandle(volumeId: string): SandboxVolumeHandleV1 {
  return {
    provider: SandboxProvider.DOCKER,
    volumeId,
    createdAt: new Date().toISOString(),
  };
}

export class DockerSandboxAdapter implements SandboxAdapter {
  readonly #client: DockerClient;

  constructor(client: DockerClient) {
    this.#client = client;
  }

  async createVolume(_request: CreateVolumeRequestV1): Promise<SandboxVolumeHandleV1> {
    const response = await this.#client.createVolume({});

    return createVolumeHandle(response.volumeId);
  }

  async deleteVolume(request: DeleteVolumeRequestV1): Promise<void> {
    if (request.volumeId.trim().length === 0) {
      throw new SandboxConfigurationError("Volume id is required.");
    }

    try {
      await this.#client.deleteVolume({ volumeId: request.volumeId });
    } catch (error) {
      if (error instanceof DockerClientError && error.code === DockerClientErrorCodes.NOT_FOUND) {
        throw new SandboxResourceNotFoundError({
          resourceType: "volume",
          resourceId: request.volumeId,
          cause: error,
        });
      }

      throw error;
    }
  }

  async start(request: SandboxStartRequest): Promise<SandboxHandle> {
    if (request.image.provider !== SandboxProvider.DOCKER) {
      throw new SandboxConfigurationError("Docker adapter received a non-Docker image handle.");
    }
    if (
      request.mounts !== undefined &&
      request.mounts.some((mount) => mount.volume.provider !== SandboxProvider.DOCKER)
    ) {
      throw new SandboxConfigurationError("Docker adapter received a non-Docker volume handle.");
    }

    const response = await this.#client.startSandbox({
      imageRef: request.image.imageId,
      ...(request.mounts === undefined
        ? {}
        : {
            mounts: request.mounts.map((mount) => ({
              volumeId: mount.volume.volumeId,
              mountPath: mount.mountPath,
            })),
          }),
      ...(request.env === undefined ? {} : { env: request.env }),
    });
    const id = response.runtimeId;

    return {
      provider: SandboxProvider.DOCKER,
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
    if (request.image.provider !== SandboxProvider.DOCKER) {
      throw new SandboxConfigurationError("Docker adapter received a non-Docker image handle.");
    }
    if (
      request.mounts !== undefined &&
      request.mounts.some((mount) => mount.volume.provider !== SandboxProvider.DOCKER)
    ) {
      throw new SandboxConfigurationError("Docker adapter received a non-Docker volume handle.");
    }
    if (request.id === undefined || request.id === null) {
      throw new SandboxConfigurationError("Docker adapter resume requires a previous runtime id.");
    }
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
