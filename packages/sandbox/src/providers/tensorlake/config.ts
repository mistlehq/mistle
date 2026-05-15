import {
  TensorlakeSandboxConfigSchema,
  type TensorlakeSandboxConfig,
  type ValidatedTensorlakeSandboxConfig,
} from "./schemas.js";

export type { TensorlakeSandboxConfig } from "./schemas.js";

export function validateTensorlakeSandboxConfig(
  config: TensorlakeSandboxConfig,
): ValidatedTensorlakeSandboxConfig {
  return TensorlakeSandboxConfigSchema.parse(config);
}
