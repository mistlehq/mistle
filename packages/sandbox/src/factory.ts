import { SandboxConfigurationError } from "./errors.js";
import { createDockerAdapter, type DockerSandboxConfig } from "./providers/docker/index.js";
import { createModalAdapter, type ModalSandboxConfig } from "./providers/modal/index.js";
import {
  SandboxProvider,
  type SandboxAdapter,
  type SandboxProvider as SandboxProviderType,
} from "./types.js";

export type CreateSandboxAdapterInput = {
  provider: SandboxProviderType;
  docker?: DockerSandboxConfig;
  modal?: ModalSandboxConfig;
};

function assertUnreachable(_value: never): never {
  throw new SandboxConfigurationError("Unsupported sandbox provider.");
}

export function createSandboxAdapter(input: CreateSandboxAdapterInput): SandboxAdapter {
  if (input.provider === SandboxProvider.MODAL) {
    if (input.modal === undefined) {
      throw new SandboxConfigurationError("Modal config is required when provider is modal.");
    }

    return createModalAdapter(input.modal);
  }

  if (input.provider === SandboxProvider.DOCKER) {
    if (input.docker === undefined) {
      throw new SandboxConfigurationError("Docker config is required when provider is docker.");
    }

    return createDockerAdapter(input.docker);
  }

  return assertUnreachable(input.provider);
}
