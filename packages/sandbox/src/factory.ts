import { SandboxConfigurationError } from "./errors.js";
import {
  createDockerAdapter,
  createDockerRuntimeControl,
  type DockerSandboxConfig,
} from "./providers/docker/index.js";
import {
  createE2BAdapter,
  createE2BRuntimeControl,
  type E2BSandboxConfig,
} from "./providers/e2b/index.js";
import {
  SandboxProvider,
  type SandboxAdapter,
  type SandboxRuntimeControl,
  type SandboxProvider as SandboxProviderType,
} from "./types.js";

export type CreateSandboxAdapterInput = {
  provider: SandboxProviderType;
  docker?: DockerSandboxConfig;
  e2b?: E2BSandboxConfig;
};

function assertUnreachable(_value: never): never {
  throw new SandboxConfigurationError("Unsupported sandbox provider.");
}

export function createSandboxAdapter(input: CreateSandboxAdapterInput): SandboxAdapter {
  if (input.provider === SandboxProvider.DOCKER) {
    if (input.docker === undefined) {
      throw new SandboxConfigurationError("Docker config is required when provider is docker.");
    }

    return createDockerAdapter(input.docker);
  }

  if (input.provider === SandboxProvider.E2B) {
    if (input.e2b === undefined) {
      throw new SandboxConfigurationError("E2B config is required when provider is e2b.");
    }

    return createE2BAdapter(input.e2b);
  }

  return assertUnreachable(input.provider);
}

export function createSandboxRuntimeControl(
  input: CreateSandboxAdapterInput,
): SandboxRuntimeControl {
  if (input.provider === SandboxProvider.DOCKER) {
    if (input.docker === undefined) {
      throw new SandboxConfigurationError("Docker config is required when provider is docker.");
    }

    return createDockerRuntimeControl(input.docker);
  }

  if (input.provider === SandboxProvider.E2B) {
    if (input.e2b === undefined) {
      throw new SandboxConfigurationError("E2B config is required when provider is e2b.");
    }

    return createE2BRuntimeControl(input.e2b);
  }

  return assertUnreachable(input.provider);
}
