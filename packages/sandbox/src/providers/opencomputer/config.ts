import {
  OpenComputerSandboxConfigSchema,
  type OpenComputerSandboxConfig,
  type ValidatedOpenComputerSandboxConfig,
} from "./schemas.js";

export type { OpenComputerSandboxConfig } from "./schemas.js";

export function validateOpenComputerSandboxConfig(
  config: OpenComputerSandboxConfig,
): ValidatedOpenComputerSandboxConfig {
  return OpenComputerSandboxConfigSchema.parse(config);
}
