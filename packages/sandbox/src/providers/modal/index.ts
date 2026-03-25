import type { SandboxAdapter, SandboxRuntimeControl } from "../../types.js";
import { createModalSandboxAdapter } from "./adapter.js";
import { ModalApiClient } from "./client.js";
import { validateModalSandboxConfig, type ModalSandboxConfig } from "./config.js";
import { createModalSandboxRuntimeControl } from "./runtime-control.js";

export type { ModalSandboxConfig } from "./config.js";

export function createModalAdapter(config: ModalSandboxConfig): SandboxAdapter {
  const validatedConfig = validateModalSandboxConfig(config);

  return createModalSandboxAdapter({
    client: new ModalApiClient(validatedConfig),
  });
}

export function createModalRuntimeControl(config: ModalSandboxConfig): SandboxRuntimeControl {
  const validatedConfig = validateModalSandboxConfig(config);

  return createModalSandboxRuntimeControl(validatedConfig);
}
