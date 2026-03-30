import { createSandboxAdapter, type SandboxAdapter, type SandboxProvider } from "@mistle/sandbox";

import type { DataPlaneApiRuntimeConfig } from "../types.js";

export function createSandboxRuntimeAdapter(config: DataPlaneApiRuntimeConfig): SandboxAdapter {
  return createSandboxAdapter(createSandboxProviderConfig(config));
}

function createSandboxProviderConfig(
  config: DataPlaneApiRuntimeConfig,
): Parameters<typeof createSandboxAdapter>[0] {
  if (config.sandboxProvider === "docker") {
    if (config.app.sandbox.docker === undefined) {
      throw new Error("Expected data-plane API docker sandbox config for global provider docker.");
    }

    return {
      provider: config.sandboxProvider,
      docker: {
        socketPath: config.app.sandbox.docker.socketPath,
      },
    };
  }

  if (config.sandboxProvider === "e2b") {
    if (config.app.sandbox.e2b === undefined) {
      throw new Error("Expected data-plane API E2B sandbox config for global provider e2b.");
    }

    return {
      provider: config.sandboxProvider,
      e2b: {
        apiKey: config.app.sandbox.e2b.apiKey,
        ...(config.app.sandbox.e2b.domain === undefined
          ? {}
          : { domain: config.app.sandbox.e2b.domain }),
      },
    };
  }

  return assertUnreachable(config.sandboxProvider);
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
