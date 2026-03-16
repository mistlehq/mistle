import { createSandboxAdapter, SandboxProvider, type SandboxAdapter } from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "./config.js";

function assertUnreachable(_value: never): never {
  throw new Error("Unsupported sandbox provider.");
}

export function createSandboxRuntimeAdapter(config: DataPlaneWorkerRuntimeConfig): SandboxAdapter {
  if (config.sandbox.provider === SandboxProvider.MODAL) {
    if (config.app.sandbox.modal === undefined) {
      throw new Error("Expected data-plane worker modal sandbox config for global provider modal.");
    }

    return createSandboxAdapter({
      provider: config.sandbox.provider,
      modal: {
        tokenId: config.app.sandbox.modal.tokenId,
        tokenSecret: config.app.sandbox.modal.tokenSecret,
        appName: config.app.sandbox.modal.appName,
        environmentName: config.app.sandbox.modal.environmentName,
      },
    });
  }

  if (config.sandbox.provider === "docker") {
    if (config.app.sandbox.docker === undefined) {
      throw new Error(
        "Expected data-plane worker docker sandbox config for global provider docker.",
      );
    }

    return createSandboxAdapter({
      provider: config.sandbox.provider,
      docker: {
        socketPath: config.app.sandbox.docker.socketPath,
        ...(config.app.sandbox.docker.networkName === undefined
          ? {}
          : { networkName: config.app.sandbox.docker.networkName }),
      },
    });
  }

  return assertUnreachable(config.sandbox.provider);
}
