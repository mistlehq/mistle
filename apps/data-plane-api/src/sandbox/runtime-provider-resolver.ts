import type {
  ControlPlaneInternalClient,
  ResolveSandboxRuntimeCredentialsOutput,
} from "@mistle/control-plane-internal-client";
import {
  OpenComputerValidResourceTiers,
  createSandboxAdapter,
  type CreateSandboxAdapterInput,
  type SandboxAdapter,
  SandboxProvider,
  type SandboxProvider as SandboxProviderValue,
} from "@mistle/sandbox";

import type { DataPlaneApiRuntimeConfig } from "../types.js";

export type ResolveSandboxRuntimeAdapterInput = {
  organizationId: string;
  provider: SandboxProviderValue;
  connectionId?: string;
  resources?: {
    vcpuCount: number;
    memoryMb: number;
    diskMb?: number;
  };
};

export async function resolveSandboxRuntimeAdapter(
  ctx: {
    config: DataPlaneApiRuntimeConfig;
    controlPlaneInternalClient: ControlPlaneInternalClient;
  },
  input: ResolveSandboxRuntimeAdapterInput,
): Promise<SandboxAdapter> {
  if (input.provider === SandboxProvider.DOCKER) {
    if (input.connectionId !== undefined) {
      throw new Error("Docker sandbox runtime cannot use a sandbox connection.");
    }

    if (ctx.config.app.sandbox.docker?.enabled !== true) {
      throw new Error("Expected data-plane API Docker sandbox config.");
    }

    return createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: ctx.config.app.sandbox.docker.socketPath,
      },
    });
  }

  const credentials = await ctx.controlPlaneInternalClient.resolveSandboxRuntimeCredentials({
    organizationId: input.organizationId,
    provider: input.provider,
    ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
  });
  if (credentials.provider !== input.provider) {
    throw new Error("Control-plane returned credentials for a different sandbox runtime provider.");
  }

  return createSandboxAdapter(
    createRemoteSandboxProviderConfig({
      credentials,
      resources: input.resources,
    }),
  );
}

function createRemoteSandboxProviderConfig(input: {
  credentials: ResolveSandboxRuntimeCredentialsOutput;
  resources?: ResolveSandboxRuntimeAdapterInput["resources"];
}): CreateSandboxAdapterInput {
  if (input.credentials.provider === SandboxProvider.DOCKER) {
    throw new Error("Docker sandbox runtime cannot be resolved as a remote provider.");
  }

  if (input.credentials.provider === SandboxProvider.E2B) {
    return createE2BSandboxProviderConfig({
      credentials: input.credentials,
      resources: input.resources,
    });
  }

  if (input.credentials.provider === SandboxProvider.TENSORLAKE) {
    return createTensorlakeSandboxProviderConfig({
      credentials: input.credentials,
      resources: input.resources,
    });
  }

  if (input.credentials.provider === SandboxProvider.MODAL) {
    return createModalSandboxProviderConfig({
      credentials: input.credentials,
      resources: input.resources,
    });
  }

  if (input.credentials.provider === SandboxProvider.OPENCOMPUTER) {
    return createOpenComputerSandboxProviderConfig({
      credentials: input.credentials,
      resources: input.resources,
    });
  }

  return assertUnreachableResolvedSandboxRuntimeCredentials(input.credentials);
}

function createE2BSandboxProviderConfig(input: {
  credentials: Extract<ResolveSandboxRuntimeCredentialsOutput, { provider: "e2b" }>;
  resources?: ResolveSandboxRuntimeAdapterInput["resources"];
}): CreateSandboxAdapterInput {
  if (input.resources?.diskMb !== undefined) {
    throw new Error("E2B sandbox runtime does not support configurable disk.");
  }

  return {
    provider: SandboxProvider.E2B,
    e2b: {
      apiKey: input.credentials.apiKey,
      ...(input.credentials.domain === undefined ? {} : { domain: input.credentials.domain }),
      ...(input.resources === undefined
        ? {}
        : {
            cpuCount: input.resources.vcpuCount,
            memoryMb: input.resources.memoryMb,
          }),
    },
  };
}

function createTensorlakeSandboxProviderConfig(input: {
  credentials: Extract<ResolveSandboxRuntimeCredentialsOutput, { provider: "tensorlake" }>;
  resources?: ResolveSandboxRuntimeAdapterInput["resources"];
}): CreateSandboxAdapterInput {
  return {
    provider: SandboxProvider.TENSORLAKE,
    tensorlake: {
      apiKey: input.credentials.apiKey,
    },
  };
}

function createModalSandboxProviderConfig(input: {
  credentials: Extract<ResolveSandboxRuntimeCredentialsOutput, { provider: "modal" }>;
  resources?: ResolveSandboxRuntimeAdapterInput["resources"];
}): CreateSandboxAdapterInput {
  if (input.resources?.diskMb !== undefined) {
    throw new Error("Modal sandbox runtime does not support configurable disk.");
  }

  return {
    provider: SandboxProvider.MODAL,
    modal: {
      tokenId: input.credentials.tokenId,
      tokenSecret: input.credentials.tokenSecret,
      appName: input.credentials.appName,
      ...(input.credentials.environment === undefined
        ? {}
        : { environment: input.credentials.environment }),
      ...(input.credentials.defaultTimeoutMs === undefined
        ? {}
        : { defaultTimeoutMs: input.credentials.defaultTimeoutMs }),
    },
  };
}

function createOpenComputerSandboxProviderConfig(input: {
  credentials: Extract<ResolveSandboxRuntimeCredentialsOutput, { provider: "opencomputer" }>;
  resources?: ResolveSandboxRuntimeAdapterInput["resources"];
}): CreateSandboxAdapterInput {
  if (input.resources?.diskMb !== undefined) {
    throw new Error("OpenComputer sandbox runtime does not support configurable disk.");
  }

  if (input.resources !== undefined && !isOpenComputerResourceTier(input.resources)) {
    throw new Error("OpenComputer sandbox runtime resources must match a supported resource tier.");
  }

  return {
    provider: SandboxProvider.OPENCOMPUTER,
    opencomputer: {
      apiKey: input.credentials.apiKey,
      ...(input.credentials.apiBaseUrl === undefined
        ? {}
        : { apiBaseUrl: input.credentials.apiBaseUrl }),
    },
  };
}

function isOpenComputerResourceTier(input: { vcpuCount: number; memoryMb: number }): boolean {
  return OpenComputerValidResourceTiers.some(
    (tier) => tier.vcpuCount === input.vcpuCount && tier.memoryMb === input.memoryMb,
  );
}

function assertUnreachableResolvedSandboxRuntimeCredentials(
  _credentials: never,
): CreateSandboxAdapterInput {
  throw new Error("Unsupported remote sandbox runtime credentials.");
}
