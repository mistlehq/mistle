import {
  createSandboxAdapter,
  createSandboxRuntimeControl as createProviderSandboxRuntimeControl,
  type SandboxAdapter,
  type SandboxRuntimeControl,
} from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "./config.js";

export function createSandboxRuntimeAdapter(config: DataPlaneWorkerRuntimeConfig): SandboxAdapter {
  return createSandboxAdapter(createSandboxProviderConfig(config));
}

export function createSandboxRuntimeControl(
  config: DataPlaneWorkerRuntimeConfig,
): SandboxRuntimeControl {
  return createProviderSandboxRuntimeControl(createSandboxProviderConfig(config));
}

function createSandboxProviderConfig(
  config: DataPlaneWorkerRuntimeConfig,
): Parameters<typeof createSandboxAdapter>[0] {
  if (config.sandbox.provider === "docker") {
    if (config.app.sandbox.docker === undefined) {
      throw new Error(
        "Expected data-plane worker docker sandbox config for global provider docker.",
      );
    }

    return {
      provider: config.sandbox.provider,
      docker: {
        socketPath: config.app.sandbox.docker.socketPath,
        ...(config.app.sandbox.docker.networkName === undefined
          ? {}
          : { networkName: config.app.sandbox.docker.networkName }),
      },
    };
  }

  if (config.sandbox.provider === "e2b") {
    if (config.app.sandbox.e2b === undefined) {
      throw new Error("Expected data-plane worker E2B sandbox config for global provider e2b.");
    }

    return {
      provider: config.sandbox.provider,
      e2b: {
        apiKey: config.app.sandbox.e2b.apiKey,
        ...(config.app.sandbox.e2b.domain === undefined
          ? {}
          : { domain: config.app.sandbox.e2b.domain }),
      },
    };
  }

  throw new Error("Unsupported sandbox provider.");
}
