import type { SandboxAdapter, SandboxRuntimeControl } from "../../types.js";
import { createDockerSandboxAdapter } from "./adapter.js";
import { DockerApiClient } from "./client.js";
import { validateDockerSandboxConfig, type DockerSandboxConfig } from "./config.js";
import { createDockerSandboxRuntimeControl } from "./runtime-control.js";

export type { DockerSandboxConfig } from "./config.js";

export function createDockerAdapter(config: DockerSandboxConfig): SandboxAdapter {
  const validatedConfig = validateDockerSandboxConfig(config);

  return createDockerSandboxAdapter({
    client: new DockerApiClient(validatedConfig),
  });
}

export function createDockerRuntimeControl(config: DockerSandboxConfig): SandboxRuntimeControl {
  const validatedConfig = validateDockerSandboxConfig(config);

  return createDockerSandboxRuntimeControl(validatedConfig);
}
