import { createFreestyleSandboxAdapter, type FreestyleSandboxAdapter } from "./adapter.js";
import {
  createFreestyleBaseImageBuilder,
  type FreestyleBaseImageBuilderOptions,
} from "./base-image-builder.js";
import { FreestyleApiClient } from "./client.js";
import { validateFreestyleSandboxConfig, type FreestyleSandboxConfig } from "./config.js";
import {
  createFreestyleSandboxRuntimeControl,
  type FreestyleSandboxRuntimeControl,
} from "./runtime-control.js";

export * from "./adapter.js";
export * from "./base-image-builder.js";
export * from "./base-image-definition.js";
export * from "./client.js";
export * from "./client-errors.js";
export * from "./config.js";
export * from "./image-handle.js";
export * from "./runtime-control.js";
export * from "./schemas.js";
export * from "./transparent-proxy.js";
export * from "./types.js";

export function createFreestyleAdapter(config: FreestyleSandboxConfig): FreestyleSandboxAdapter {
  const validatedConfig = validateFreestyleSandboxConfig(config);
  return createFreestyleSandboxAdapter({
    client: createFreestyleApiClientFromConfig(validatedConfig),
    ...(validatedConfig.idleTimeoutSeconds === undefined
      ? {}
      : { idleTimeoutSeconds: validatedConfig.idleTimeoutSeconds }),
  });
}

export function createFreestyleRuntimeControl(
  config: FreestyleSandboxConfig,
): FreestyleSandboxRuntimeControl {
  const validatedConfig = validateFreestyleSandboxConfig(config);
  return createFreestyleSandboxRuntimeControl({
    client: createFreestyleApiClientFromConfig(validatedConfig),
  });
}

export function createFreestyleBaseImageBuilderFromConfig(
  config: FreestyleSandboxConfig,
): ReturnType<typeof createFreestyleBaseImageBuilder> {
  const validatedConfig = validateFreestyleSandboxConfig(config);
  return createFreestyleBaseImageBuilder({
    client: createFreestyleApiClientFromConfig(validatedConfig),
  });
}

export type { FreestyleBaseImageBuilderOptions };

function createFreestyleApiClientFromConfig(config: {
  readonly apiKey: string;
  readonly baseUrl?: string | undefined;
}): FreestyleApiClient {
  return new FreestyleApiClient({
    apiKey: config.apiKey,
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  });
}
