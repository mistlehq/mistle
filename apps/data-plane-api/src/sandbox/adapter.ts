import {
  createSandboxAdapter,
  createSandboxRuntimeControl,
  type SandboxAdapter,
  type SandboxProvider,
  type SandboxRuntimeControl,
} from "@mistle/sandbox";

import type { DataPlaneApiRuntimeConfig } from "../types.js";

export function createSandboxRuntimeAdapter(config: DataPlaneApiRuntimeConfig): SandboxAdapter {
  return createSandboxAdapter(createSandboxProviderConfig(config));
}

export function createDataPlaneSandboxRuntimeControl(
  config: DataPlaneApiRuntimeConfig,
): SandboxRuntimeControl {
  return createSandboxRuntimeControl(createSandboxProviderConfig(config));
}

function createSandboxProviderConfig(
  config: DataPlaneApiRuntimeConfig,
): Parameters<typeof createSandboxAdapter>[0] {
  if (config.app.sandbox.provider === "docker") {
    if (config.app.sandbox.docker === undefined) {
      throw new Error("Expected data-plane API docker sandbox config for global provider docker.");
    }

    return {
      provider: config.app.sandbox.provider,
      docker: {
        socketPath: config.app.sandbox.docker.socketPath,
      },
    };
  }

  if (config.app.sandbox.provider === "e2b") {
    if (config.app.sandbox.e2b === undefined) {
      throw new Error("Expected data-plane API E2B sandbox config for global provider e2b.");
    }

    return {
      provider: config.app.sandbox.provider,
      e2b: {
        apiKey: config.app.sandbox.e2b.apiKey,
        ...(config.app.sandbox.e2b.domain === undefined
          ? {}
          : { domain: config.app.sandbox.e2b.domain }),
      },
    };
  }

  return assertUnreachable(config.app.sandbox.provider);
}

function assertUnreachable(_value: never): never {
  throw new Error("Unsupported sandbox provider.");
}

export function assertRuntimeSandboxProvider(
  runtimeProvider: string,
): asserts runtimeProvider is SandboxProvider {
  if (runtimeProvider === "docker" || runtimeProvider === "e2b") {
    return;
  }

  throw new Error("Unsupported persisted sandbox provider.");
}
