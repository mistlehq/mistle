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

  throw new Error("Unsupported sandbox provider.");
}
