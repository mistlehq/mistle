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
  type CreateVolumeRequestV1,
  type DeleteVolumeRequestV1,
  type SandboxVolumeHandleV1,
} from "../../types.js";
import { ModalClientError, ModalClientErrorCodes } from "./client-errors.js";
import type { ModalClient } from "./client.js";

function createVolumeHandle(volumeId: string): SandboxVolumeHandleV1 {
  return {
    provider: SandboxProvider.MODAL,
    volumeId,
    createdAt: new Date().toISOString(),
  };
}

export class ModalSandboxAdapter implements SandboxAdapter {
  readonly #client: ModalClient;

  constructor(client: ModalClient) {
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
      if (error instanceof ModalClientError && error.code === ModalClientErrorCodes.NOT_FOUND) {
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
    if (request.image.provider !== SandboxProvider.MODAL) {
      throw new SandboxConfigurationError("Modal adapter received a non-Modal image handle.");
    }
    if (
      request.mounts !== undefined &&
      request.mounts.some((mount) => mount.volume.provider !== SandboxProvider.MODAL)
    ) {
      throw new SandboxConfigurationError("Modal adapter received a non-Modal volume handle.");
    }

    const response = await this.#client.startSandbox({
      imageId: request.image.imageId,
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
    const runtimeId = response.runtimeId;

    return {
      provider: SandboxProvider.MODAL,
      runtimeId,
      writeStdin: async (input) => {
        await this.#client.writeSandboxStdin({
          runtimeId,
          payload: input.payload,
        });
      },
      closeStdin: async () => {
        await this.#client.closeSandboxStdin({
          runtimeId,
        });
      },
    };
  }

  async stop(request: SandboxStopRequest): Promise<void> {
    if (request.runtimeId.trim().length === 0) {
      throw new SandboxConfigurationError("Runtime id is required.");
    }

    try {
      await this.#client.stopSandbox({ runtimeId: request.runtimeId });
    } catch (error) {
      if (error instanceof ModalClientError && error.code === ModalClientErrorCodes.NOT_FOUND) {
        throw new SandboxResourceNotFoundError({
          resourceType: "sandbox",
          resourceId: request.runtimeId,
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
