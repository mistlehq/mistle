import type {
  ControlPlaneInternalClient,
  ResolveSandboxRuntimeCredentialsOutput,
} from "@mistle/control-plane-internal-client";
import {
  createSandboxAdapter,
  createSandboxRuntimeControl,
  type CreateSandboxAdapterInput,
  SandboxProvider,
  SandboxSdkImageSandboxdSourceKinds,
  type SandboxAdapter,
  type SandboxSdkImageReleaseSandboxdSource,
  type SandboxRuntimeControl,
  type SandboxProvider as SandboxProviderValue,
} from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "./config.js";
import type { SandboxdArtifactResolver } from "./sandboxd-artifact-resolver.js";

export type ResolveSandboxRuntimeInput = {
  organizationId: string;
  provider: SandboxProviderValue;
  connectionId?: string;
  resources?: {
    vcpuCount: number;
    memoryMb: number;
    storageMb?: number;
  };
};

export type ResolvedSandboxRuntime = {
  provider: SandboxProviderValue;
  sandboxAdapter: SandboxAdapter;
  sandboxRuntimeControl: SandboxRuntimeControl;
};

export type SandboxRuntimeProviderResolver = {
  resolve(input: ResolveSandboxRuntimeInput): Promise<ResolvedSandboxRuntime>;
  resolveForImagePreparation(input: ResolveSandboxRuntimeInput): Promise<ResolvedSandboxRuntime>;
};

export type PersistedSandboxSelection = {
  organizationId: string;
  runtimeProvider: SandboxProviderValue;
  sandboxConnectionId: string | null;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxStorageMb: number | null;
};

export function createResolveSandboxRuntimeInput(
  input: PersistedSandboxSelection,
): ResolveSandboxRuntimeInput {
  const resources = createPersistedSandboxResources(input);

  return {
    organizationId: input.organizationId,
    provider: input.runtimeProvider,
    ...(input.sandboxConnectionId === null ? {} : { connectionId: input.sandboxConnectionId }),
    ...(resources === undefined ? {} : { resources }),
  };
}

export function createSandboxRuntimeProviderResolver(input: {
  config: DataPlaneWorkerRuntimeConfig;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  sandboxdArtifactResolver?: SandboxdArtifactResolver;
}): SandboxRuntimeProviderResolver {
  async function resolveRuntime(
    inputRuntime: ResolveSandboxRuntimeInput,
    options: {
      includeImagePreparationArtifacts: boolean;
    },
  ): Promise<ResolvedSandboxRuntime> {
    if (inputRuntime.provider === SandboxProvider.DOCKER) {
      if (inputRuntime.connectionId !== undefined) {
        throw new Error("Docker sandbox runtime cannot use a sandbox connection.");
      }

      if (input.config.app.sandbox.docker?.enabled !== true) {
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

    if (inputRuntime.provider === SandboxProvider.E2B) {
      const credentials = await input.controlPlaneInternalClient.resolveSandboxRuntimeCredentials({
        organizationId: inputRuntime.organizationId,
        provider: SandboxProvider.E2B,
        ...(inputRuntime.connectionId === undefined
          ? {}
          : { connectionId: inputRuntime.connectionId }),
      });
      if (credentials.provider !== SandboxProvider.E2B) {
        throw new Error("Control-plane returned non-E2B credentials for E2B runtime.");
      }

      return createE2BSandboxRuntime({
        credentials,
        resources: inputRuntime.resources,
      });
    }

    if (inputRuntime.provider === SandboxProvider.TENSORLAKE) {
      const credentials = await input.controlPlaneInternalClient.resolveSandboxRuntimeCredentials({
        organizationId: inputRuntime.organizationId,
        provider: SandboxProvider.TENSORLAKE,
        ...(inputRuntime.connectionId === undefined
          ? {}
          : { connectionId: inputRuntime.connectionId }),
      });
      if (credentials.provider !== SandboxProvider.TENSORLAKE) {
        throw new Error(
          "Control-plane returned non-Tensorlake credentials for Tensorlake runtime.",
        );
      }

      const needsRuntimeImageArtifacts =
        options.includeImagePreparationArtifacts && inputRuntime.connectionId !== undefined;
      const sandboxdArtifact =
        needsRuntimeImageArtifacts && input.sandboxdArtifactResolver !== undefined
          ? await input.sandboxdArtifactResolver.resolve()
          : undefined;

      return createTensorlakeSandboxRuntime({
        credentials,
        resources: inputRuntime.resources,
        ...(sandboxdArtifact === undefined
          ? {}
          : {
              sandboxd: {
                kind: SandboxSdkImageSandboxdSourceKinds.RELEASE,
                artifact: sandboxdArtifact,
              },
            }),
      });
    }

    return assertUnreachableSandboxProvider(inputRuntime.provider);
  }

  return {
    resolve: (runtimeInput) =>
      resolveRuntime(runtimeInput, { includeImagePreparationArtifacts: false }),
    resolveForImagePreparation: (runtimeInput) =>
      resolveRuntime(runtimeInput, { includeImagePreparationArtifacts: true }),
  };
}

function createPersistedSandboxResources(input: {
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxStorageMb: number | null;
}): ResolveSandboxRuntimeInput["resources"] | undefined {
  if (
    input.sandboxVcpuCount === null &&
    input.sandboxMemoryMb === null &&
    input.sandboxStorageMb === null
  ) {
    return undefined;
  }

  if (input.sandboxVcpuCount === null || input.sandboxMemoryMb === null) {
    throw new Error("Persisted sandbox resources are incomplete.");
  }

  return {
    vcpuCount: input.sandboxVcpuCount,
    memoryMb: input.sandboxMemoryMb,
    ...(input.sandboxStorageMb === null ? {} : { storageMb: input.sandboxStorageMb }),
  };
}

function assertUnreachableSandboxProvider(_provider: never): never {
  throw new Error("Unsupported sandbox runtime provider.");
}

function createE2BSandboxRuntime(input: {
  credentials: Extract<ResolveSandboxRuntimeCredentialsOutput, { provider: "e2b" }>;
  resources?: ResolveSandboxRuntimeInput["resources"];
}): ResolvedSandboxRuntime {
  const providerConfig = createE2BSandboxProviderConfig(input);

  return {
    provider: SandboxProvider.E2B,
    sandboxAdapter: createSandboxAdapter(providerConfig),
    sandboxRuntimeControl: createSandboxRuntimeControl(providerConfig),
  };
}

export function createE2BSandboxProviderConfig(input: {
  credentials: Extract<ResolveSandboxRuntimeCredentialsOutput, { provider: "e2b" }>;
  resources?: ResolveSandboxRuntimeInput["resources"];
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

function createTensorlakeSandboxRuntime(input: {
  credentials: Extract<ResolveSandboxRuntimeCredentialsOutput, { provider: "tensorlake" }>;
  resources?: ResolveSandboxRuntimeInput["resources"];
  sandboxd?: SandboxSdkImageReleaseSandboxdSource;
}): ResolvedSandboxRuntime {
  const providerConfig = createTensorlakeSandboxProviderConfig(input);

  return {
    provider: SandboxProvider.TENSORLAKE,
    sandboxAdapter: createSandboxAdapter(providerConfig),
    sandboxRuntimeControl: createSandboxRuntimeControl(providerConfig),
  };
}

export function createTensorlakeSandboxProviderConfig(input: {
  credentials: Extract<ResolveSandboxRuntimeCredentialsOutput, { provider: "tensorlake" }>;
  resources?: ResolveSandboxRuntimeInput["resources"];
  sandboxd?: SandboxSdkImageReleaseSandboxdSource;
}): CreateSandboxAdapterInput {
  return {
    provider: SandboxProvider.TENSORLAKE,
    tensorlake: {
      apiKey: input.credentials.apiKey,
      ...(input.sandboxd === undefined ? {} : { sandboxd: input.sandboxd }),
    },
  };
}
