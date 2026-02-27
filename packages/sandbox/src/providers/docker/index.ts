import type { SandboxAdapter } from "../../types.js";

import { createDockerSandboxAdapter } from "./adapter.js";
import { DockerApiClient } from "./client.js";
import { validateDockerSandboxConfig, type DockerSandboxConfig } from "./config.js";

export type { DockerSandboxConfig } from "./config.js";

export function createDockerAdapter(config: DockerSandboxConfig): SandboxAdapter {
  const validatedConfig = validateDockerSandboxConfig(config);

  return createDockerSandboxAdapter({
    client: new DockerApiClient(validatedConfig),
  });
}
