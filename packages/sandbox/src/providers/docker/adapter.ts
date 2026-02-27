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

    const response = await this.#client.startSandbox({ imageRef: request.image.imageId });

    return {
      provider: SandboxProvider.DOCKER,
      sandboxId: response.sandboxId,
    };
  }

  async snapshot(request: SandboxSnapshotRequest): Promise<SandboxImageHandle> {
    const response = await this.#client.snapshotSandbox({ sandboxId: request.sandboxId });

    return {
      provider: SandboxProvider.DOCKER,
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

export function createDockerSandboxAdapter(input: { client: DockerClient }): SandboxAdapter {
  if (input.client === undefined) {
    throw new SandboxProviderNotImplementedError("Docker client is required to construct adapter.");
  }

  return new DockerSandboxAdapter(input.client);
}
