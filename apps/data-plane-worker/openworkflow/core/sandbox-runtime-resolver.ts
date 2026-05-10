import type {
  ControlPlaneInternalClient,
  ResolveSandboxRuntimeCredentialsOutput,
} from "@mistle/control-plane-internal-client";
import {
  createSandboxAdapter,
  createSandboxRuntimeControl,
  SandboxProvider,
  type SandboxAdapter,
  type SandboxRuntimeControl,
  type SandboxProvider as SandboxProviderValue,
} from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "./config.js";

export type ResolveSandboxRuntimeInput = {
  organizationId: string;
  provider: SandboxProviderValue;
  connectionId?: string;
};

export type ResolvedSandboxRuntime = {
  provider: SandboxProviderValue;
  sandboxAdapter: SandboxAdapter;
  sandboxRuntimeControl: SandboxRuntimeControl;
};

export type SandboxRuntimeProviderResolver = {
  resolve(input: ResolveSandboxRuntimeInput): Promise<ResolvedSandboxRuntime>;
};

export function createSandboxRuntimeProviderResolver(input: {
  config: DataPlaneWorkerRuntimeConfig;
  controlPlaneInternalClient: ControlPlaneInternalClient;
}): SandboxRuntimeProviderResolver {
  return {
    resolve: async (runtimeInput) => {
      if (runtimeInput.provider === SandboxProvider.DOCKER) {
        if (runtimeInput.connectionId !== undefined) {
          throw new Error("Docker sandbox runtime cannot use a sandbox connection.");
        }

        if (input.config.app.sandbox.docker === undefined) {
          throw new Error("Expected data-plane worker Docker sandbox config.");
        }

        const providerConfig = {
          provider: SandboxProvider.DOCKER,
          docker: {
            socketPath: input.config.app.sandbox.docker.socketPath,
            ...(input.config.app.sandbox.docker.networkName === undefined
              ? {}
              : { networkName: input.config.app.sandbox.docker.networkName }),
          },
        };

        return {
          provider: SandboxProvider.DOCKER,
          sandboxAdapter: createSandboxAdapter(providerConfig),
          sandboxRuntimeControl: createSandboxRuntimeControl(providerConfig),
        };
      }

      if (runtimeInput.provider === SandboxProvider.E2B) {
        const credentials = await input.controlPlaneInternalClient.resolveSandboxRuntimeCredentials(
          {
            organizationId: runtimeInput.organizationId,
            provider: SandboxProvider.E2B,
            ...(runtimeInput.connectionId === undefined
              ? {}
              : { connectionId: runtimeInput.connectionId }),
          },
        );
        if (credentials.provider !== SandboxProvider.E2B) {
          throw new Error("Control-plane returned non-E2B credentials for E2B runtime.");
        }

        return createE2BSandboxRuntime({ credentials });
      }

      return assertUnreachableSandboxProvider(runtimeInput.provider);
    },
  };
}

function assertUnreachableSandboxProvider(_provider: never): never {
  throw new Error("Unsupported sandbox runtime provider.");
}

function createE2BSandboxRuntime(input: {
  credentials: Extract<ResolveSandboxRuntimeCredentialsOutput, { provider: "e2b" }>;
}): ResolvedSandboxRuntime {
  const providerConfig = {
    provider: SandboxProvider.E2B,
    e2b: {
      apiKey: input.credentials.apiKey,
      ...(input.credentials.domain === undefined ? {} : { domain: input.credentials.domain }),
    },
  };

  return {
    provider: SandboxProvider.E2B,
    sandboxAdapter: createSandboxAdapter(providerConfig),
    sandboxRuntimeControl: createSandboxRuntimeControl(providerConfig),
  };
}
