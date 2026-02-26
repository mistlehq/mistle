import { ModalSandboxConfigSchema, type ModalSandboxConfig } from "./schemas.js";

export type { ModalSandboxConfig } from "./schemas.js";

export function validateModalSandboxConfig(config: ModalSandboxConfig): ModalSandboxConfig {
  return ModalSandboxConfigSchema.parse(config);
}
