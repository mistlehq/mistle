import type { SandboxRuntimeControl } from "../../types.js";
import { OpenComputerSandboxAdapter, createOpenComputerSandboxAdapter } from "./adapter.js";
import {
  OpenComputerBaseImageBuilder,
  createOpenComputerBaseImageBuilder,
} from "./base-image-builder.js";
import { OpenComputerApiClient } from "./client.js";
import { validateOpenComputerSandboxConfig, type OpenComputerSandboxConfig } from "./config.js";
import { createOpenComputerSandboxRuntimeControl } from "./runtime-control.js";

export type { OpenComputerSandboxConfig } from "./config.js";
export type { OpenComputerSandboxInspectResult } from "./types.js";
export { OpenComputerValidResourceTiers } from "./schemas.js";
export { OpenComputerSandboxAdapter } from "./adapter.js";
export {
  OpenComputerBaseImageBuilder,
  createOpenComputerBaseImageBuilder,
  type OpenComputerBaseImageBuilderOptions,
} from "./base-image-builder.js";
export {
  createOpenComputerBaseImageName,
  createOpenComputerCheckpointImageHandle,
  createOpenComputerDeferredImageHandle,
  createOpenComputerSnapshotImageHandle,
  createOpenComputerTemplateImageHandle,
  parseOpenComputerImageHandle,
} from "./image-handle.js";

export function createOpenComputerAdapter(
  config: OpenComputerSandboxConfig,
): OpenComputerSandboxAdapter {
  const validatedConfig = validateOpenComputerSandboxConfig(config);
  return createOpenComputerSandboxAdapter({
    client: new OpenComputerApiClient({ config: validatedConfig }),
  });
}

export function createOpenComputerRuntimeControl(
  config: OpenComputerSandboxConfig,
): SandboxRuntimeControl {
  const validatedConfig = validateOpenComputerSandboxConfig(config);
  return createOpenComputerSandboxRuntimeControl(
    new OpenComputerApiClient({ config: validatedConfig }),
  );
}

export function createOpenComputerBaseImageBuilderFromConfig(
  config: OpenComputerSandboxConfig,
): OpenComputerBaseImageBuilder {
  const validatedConfig = validateOpenComputerSandboxConfig(config);
  return createOpenComputerBaseImageBuilder({
    client: new OpenComputerApiClient({ config: validatedConfig }),
  });
}
