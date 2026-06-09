import { createModalSandboxAdapter, type ModalSandboxAdapter } from "./adapter.js";
import {
  createModalBaseImageBuilder,
  type ModalBaseImageBuilderOptions,
} from "./base-image-builder.js";
import { ModalApiClient } from "./client.js";
import { validateModalSandboxConfig, type ModalSandboxConfig } from "./config.js";
import {
  createModalSandboxRuntimeControl,
  type ModalSandboxRuntimeControl,
} from "./runtime-control.js";

export * from "./adapter.js";
export * from "./base-image-builder.js";
export * from "./client.js";
export * from "./client-errors.js";
export * from "./config.js";
export * from "./runtime-control.js";
export * from "./schemas.js";
export * from "./transparent-proxy.js";
export * from "./types.js";

export function createModalAdapter(config: ModalSandboxConfig): ModalSandboxAdapter {
  const validatedConfig = validateModalSandboxConfig(config);
  return createModalSandboxAdapter({
    client: new ModalApiClient({ config: validatedConfig }),
  });
}

export function createModalRuntimeControl(config: ModalSandboxConfig): ModalSandboxRuntimeControl {
  const validatedConfig = validateModalSandboxConfig(config);
  return createModalSandboxRuntimeControl({
    client: new ModalApiClient({ config: validatedConfig }),
  });
}

export function createModalBaseImageBuilderFromConfig(
  config: ModalSandboxConfig,
): ReturnType<typeof createModalBaseImageBuilder> {
  const validatedConfig = validateModalSandboxConfig(config);
  return createModalBaseImageBuilder({
    client: new ModalApiClient({ config: validatedConfig }),
  });
}

export type { ModalBaseImageBuilderOptions };
