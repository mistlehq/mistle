import type { SandboxRuntimeControl } from "../../types.js";
import { E2BSandboxAdapter, createE2BSandboxAdapter } from "./adapter.js";
import { E2BApiClient } from "./client.js";
import { validateE2BSandboxConfig, type E2BSandboxConfig } from "./config.js";
import { createE2BSandboxRuntimeControl } from "./runtime-control.js";

export type { E2BSandboxConfig } from "./config.js";
export type { E2BSandboxInspectResult } from "./types.js";
export { E2BSandboxAdapter } from "./adapter.js";

export function createE2BAdapter(config: E2BSandboxConfig): E2BSandboxAdapter {
  const validatedConfig = validateE2BSandboxConfig(config);

  return createE2BSandboxAdapter({
    client: new E2BApiClient({
      config: validatedConfig,
    }),
  });
}

export function createE2BRuntimeControl(config: E2BSandboxConfig): SandboxRuntimeControl {
  const validatedConfig = validateE2BSandboxConfig(config);

  return createE2BSandboxRuntimeControl(
    new E2BApiClient({
      config: validatedConfig,
    }),
  );
}
