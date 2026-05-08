import {
  createSandboxAdapter,
  createSandboxRuntimeControl as createProviderSandboxRuntimeControl,
  type SandboxAdapter,
  type SandboxProvider,
  type SandboxRuntimeControl,
} from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "./config.js";

export type SandboxRuntimeProviderSelection = {
  provider: SandboxProvider;
};

export type ResolvedSandboxRuntimeProvider = {
  provider: SandboxProvider;
  sandboxAdapter: SandboxAdapter;
  sandboxRuntimeControl: SandboxRuntimeControl;
};

export type SandboxRuntimeProviderResolver = {
  resolve: (selection: SandboxRuntimeProviderSelection) => Promise<ResolvedSandboxRuntimeProvider>;
  close: () => Promise<void>;
};

export function createSandboxRuntimeAdapter(config: DataPlaneWorkerRuntimeConfig): SandboxAdapter {
  return createSandboxAdapter(createSandboxProviderConfig(config));
}

export function createSandboxRuntimeControl(
  config: DataPlaneWorkerRuntimeConfig,
): SandboxRuntimeControl {
  return createProviderSandboxRuntimeControl(createSandboxProviderConfig(config));
}

export function createConfigBackedSandboxRuntimeProviderResolver(
  config: DataPlaneWorkerRuntimeConfig,
): SandboxRuntimeProviderResolver {
  const configuredProvider = config.sandbox.provider;
  const providerConfig = createSandboxProviderConfig(config);
  const sandboxAdapter = createSandboxAdapter(providerConfig);
  const sandboxRuntimeControl = createProviderSandboxRuntimeControl(providerConfig);

  return {
    resolve: async (selection) => {
      if (selection.provider !== configuredProvider) {
        throw new Error(
          `Sandbox runtime provider '${selection.provider}' is not available in this deployment.`,
        );
      }

      return {
        provider: configuredProvider,
        sandboxAdapter,
        sandboxRuntimeControl,
      };
    },
    close: async () => {
      await sandboxRuntimeControl.close();
    },
  };
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
        ...(config.app.sandbox.e2b.cpuCount === undefined
          ? {}
          : { cpuCount: config.app.sandbox.e2b.cpuCount }),
        ...(config.app.sandbox.e2b.memoryMb === undefined
          ? {}
          : { memoryMb: config.app.sandbox.e2b.memoryMb }),
      },
    };
  }

  throw new Error("Unsupported sandbox provider.");
}
