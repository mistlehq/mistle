import type { ModalClient } from "./client.js";

import { SandboxConfigurationError, SandboxProviderNotImplementedError } from "../../errors.js";
import {
  SandboxImageKind,
  SandboxProvider,
  type SandboxAdapter,
  type SandboxHandle,
  type SandboxImageHandle,
  type SandboxSnapshotRequest,
  type SandboxStartRequest,
  type SandboxStopRequest,
} from "../../types.js";

export class ModalSandboxAdapter implements SandboxAdapter {
  readonly #client: ModalClient;

  constructor(client: ModalClient) {
    this.#client = client;
  }

  async start(request: SandboxStartRequest): Promise<SandboxHandle> {
    if (request.image.provider !== SandboxProvider.MODAL) {
      throw new SandboxConfigurationError("Modal adapter received a non-Modal image handle.");
    }

    const response = await this.#client.startSandbox({ imageId: request.image.imageId });

    return {
      provider: SandboxProvider.MODAL,
      sandboxId: response.sandboxId,
    };
  }

  async snapshot(request: SandboxSnapshotRequest): Promise<SandboxImageHandle> {
    const response = await this.#client.snapshotSandbox({ sandboxId: request.sandboxId });

    return {
      provider: SandboxProvider.MODAL,
      imageId: response.imageId,
      kind: SandboxImageKind.SNAPSHOT,
      createdAt: response.createdAt,
    };
  }

  async stop(request: SandboxStopRequest): Promise<void> {
    if (request.sandboxId.trim().length === 0) {
      throw new SandboxConfigurationError("Sandbox id is required.");
    }

    await this.#client.stopSandbox({ sandboxId: request.sandboxId });
  }
}

export function createModalSandboxAdapter(input: { client: ModalClient }): SandboxAdapter {
  if (input.client === undefined) {
    throw new SandboxProviderNotImplementedError("Modal client is required to construct adapter.");
  }

  return new ModalSandboxAdapter(input.client);
}
