import { E2BSandboxConfigSchema, type E2BSandboxConfig } from "./schemas.js";

export type { E2BSandboxConfig } from "./schemas.js";

export function validateE2BSandboxConfig(config: E2BSandboxConfig): E2BSandboxConfig {
  return E2BSandboxConfigSchema.parse(config);
}
