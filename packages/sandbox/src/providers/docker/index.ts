import type { SandboxRuntimeControl } from "../../types.js";
import { DockerSandboxAdapter, createDockerSandboxAdapter } from "./adapter.js";
import { DockerApiClient } from "./client.js";
import { validateDockerSandboxConfig, type DockerSandboxConfig } from "./config.js";
import { createDockerSandboxRuntimeControl } from "./runtime-control.js";

export type { DockerSandboxConfig } from "./config.js";
export type { DockerSandboxInspectInfo, DockerSandboxInspectResult } from "./types.js";
export { DockerSandboxAdapter } from "./adapter.js";

export function createDockerAdapter(config: DockerSandboxConfig): DockerSandboxAdapter {
  const validatedConfig = validateDockerSandboxConfig(config);

  return createDockerSandboxAdapter({
    client: new DockerApiClient(validatedConfig),
  });
}

export function createDockerRuntimeControl(config: DockerSandboxConfig): SandboxRuntimeControl {
  const validatedConfig = validateDockerSandboxConfig(config);

  return createDockerSandboxRuntimeControl(validatedConfig);
}
