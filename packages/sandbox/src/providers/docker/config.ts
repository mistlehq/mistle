import { DockerSandboxConfigSchema, type DockerSandboxConfig } from "./schemas.js";

export type { DockerSandboxConfig } from "./schemas.js";

export function validateDockerSandboxConfig(config: DockerSandboxConfig): DockerSandboxConfig {
  return DockerSandboxConfigSchema.parse(config);
}
