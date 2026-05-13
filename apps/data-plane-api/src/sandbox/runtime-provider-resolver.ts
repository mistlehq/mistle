import type {
  ControlPlaneInternalClient,
  ResolveSandboxRuntimeCredentialsOutput,
} from "@mistle/control-plane-internal-client";
import {
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
    storageMb?: number;
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

  return assertUnreachableResolvedSandboxRuntimeCredentials(input.credentials);
}

function createE2BSandboxProviderConfig(input: {
  credentials: Extract<ResolveSandboxRuntimeCredentialsOutput, { provider: "e2b" }>;
  resources?: ResolveSandboxRuntimeAdapterInput["resources"];
}): CreateSandboxAdapterInput {
  if (input.resources?.storageMb !== undefined) {
    throw new Error("E2B sandbox runtime does not support configurable storage.");
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

function assertUnreachableResolvedSandboxRuntimeCredentials(
  _credentials: never,
): CreateSandboxAdapterInput {
  throw new Error("Unsupported remote sandbox runtime credentials.");
}
