import type { SandboxRuntimeControl } from "../../types.js";
import { DockerSandboxAdapter, createDockerSandboxAdapter } from "./adapter.js";
import { DockerApiClient, type DockerClient } from "./client.js";
import { validateDockerSandboxConfig, type DockerSandboxConfig } from "./config.js";
import { createDockerSandboxRuntimeControl } from "./runtime-control.js";

export type { DockerSandboxConfig } from "./config.js";
export type { DockerSandboxInspectResult } from "./types.js";
export type { DockerClient } from "./client.js";
export { DockerSandboxAdapter } from "./adapter.js";

export function createDockerClient(config: DockerSandboxConfig): DockerClient {
  const validatedConfig = validateDockerSandboxConfig(config);

  return new DockerApiClient(validatedConfig);
}

export function createDockerAdapter(config: DockerSandboxConfig): DockerSandboxAdapter {
  return createDockerSandboxAdapter({
    client: createDockerClient(config),
  });
}

export function createDockerRuntimeControl(config: DockerSandboxConfig): SandboxRuntimeControl {
  const validatedConfig = validateDockerSandboxConfig(config);

  return createDockerSandboxRuntimeControl(validatedConfig);
}
