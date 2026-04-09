import {
  E2BSandboxConfigSchema,
  type E2BSandboxConfig,
  type ValidatedE2BSandboxConfig,
} from "./schemas.js";

export type { E2BSandboxConfig } from "./schemas.js";

export function validateE2BSandboxConfig(config: E2BSandboxConfig): ValidatedE2BSandboxConfig {
  return E2BSandboxConfigSchema.parse(config);
}
