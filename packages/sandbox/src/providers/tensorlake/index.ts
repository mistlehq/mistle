import type { SandboxRuntimeControl } from "../../types.js";
import { TensorlakeSandboxAdapter, createTensorlakeSandboxAdapter } from "./adapter.js";
import { TensorlakeApiClient } from "./client.js";
import { validateTensorlakeSandboxConfig, type TensorlakeSandboxConfig } from "./config.js";
import { createTensorlakeSandboxRuntimeControl } from "./runtime-control.js";

export type { TensorlakeSandboxConfig } from "./config.js";
export type { TensorlakeSandboxInspectResult } from "./types.js";
export { TensorlakeSandboxAdapter } from "./adapter.js";
export {
  TensorlakeBaseImageBuilder,
  createTensorlakeBaseImageBuilder,
  type TensorlakeBaseImageBuilderOptions,
} from "./base-image-builder.js";
export {
  createTensorlakeRegisteredBaseImageName,
  createTensorlakeRegisteredImageHandle,
  createTensorlakeSnapshotImageHandle,
  parseTensorlakeImageHandle,
  resolveTensorlakeStartImage,
} from "./image-handle.js";

export function createTensorlakeAdapter(config: TensorlakeSandboxConfig): TensorlakeSandboxAdapter {
  const validatedConfig = validateTensorlakeSandboxConfig(config);
  return createTensorlakeSandboxAdapter({
    client: new TensorlakeApiClient({ config: validatedConfig }),
  });
}

export function createTensorlakeRuntimeControl(
  config: TensorlakeSandboxConfig,
): SandboxRuntimeControl {
  const validatedConfig = validateTensorlakeSandboxConfig(config);
  return createTensorlakeSandboxRuntimeControl(
    new TensorlakeApiClient({ config: validatedConfig }),
  );
}
