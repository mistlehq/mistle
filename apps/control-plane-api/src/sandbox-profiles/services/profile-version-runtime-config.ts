import { IntegrationKinds, type IntegrationRegistry } from "@mistle/integrations-core";
import { SandboxProvider } from "@mistle/sandbox";

import type { ControlPlaneApiSandboxRuntimeConfig } from "../../types.js";

export type SandboxProfileVersionResources = {
  vcpuCount: number;
  memoryMb: number;
  storageMb?: number | undefined;
};

export type SandboxProfileVersionRuntimeConfig = {
  sandboxProvider: string | null;
  sandboxConnectionId: string | null;
  sandboxResources: SandboxProfileVersionResources | null;
};

export type SandboxProfileVersionRuntimeConfigColumns = {
  sandboxProvider: string | null;
  sandboxConnectionId: string | null;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxStorageMb: number | null;
};

export function createDefaultProfileVersionRuntimeConfig(input: {
  integrationRegistry: IntegrationRegistry;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
}): SandboxProfileVersionRuntimeConfigColumns {
  if (input.sandboxConfig.provider === SandboxProvider.DOCKER) {
    return {
      sandboxProvider: SandboxProvider.DOCKER,
      sandboxConnectionId: null,
      sandboxVcpuCount: null,
      sandboxMemoryMb: null,
      sandboxStorageMb: null,
    };
  }

  if (input.sandboxConfig.provider === SandboxProvider.E2B) {
    const resourceCapabilities = findSandboxRuntimeResourceCapabilities({
      integrationRegistry: input.integrationRegistry,
      providerId: SandboxProvider.E2B,
    });

    return {
      sandboxProvider: SandboxProvider.E2B,
      sandboxConnectionId: null,
      sandboxVcpuCount: resourceCapabilities.vcpuCount.default,
      sandboxMemoryMb: resourceCapabilities.memoryMb.default,
      sandboxStorageMb: resourceCapabilities.storageMb?.default ?? null,
    };
  }

  throw new Error("Unsupported sandbox provider.");
}

export function mapProfileVersionRuntimeConfig(
  columns: SandboxProfileVersionRuntimeConfigColumns,
): SandboxProfileVersionRuntimeConfig {
  return {
    sandboxProvider: columns.sandboxProvider,
    sandboxConnectionId: columns.sandboxConnectionId,
    sandboxResources: mapProfileVersionResources(columns),
  };
}

function mapProfileVersionResources(
  columns: Pick<
    SandboxProfileVersionRuntimeConfigColumns,
    "sandboxVcpuCount" | "sandboxMemoryMb" | "sandboxStorageMb"
  >,
): SandboxProfileVersionResources | null {
  if (columns.sandboxVcpuCount === null || columns.sandboxMemoryMb === null) {
    return null;
  }

  return {
    vcpuCount: columns.sandboxVcpuCount,
    memoryMb: columns.sandboxMemoryMb,
    ...(columns.sandboxStorageMb === null ? {} : { storageMb: columns.sandboxStorageMb }),
  };
}

function findSandboxRuntimeResourceCapabilities(input: {
  integrationRegistry: IntegrationRegistry;
  providerId: string;
}) {
  const definition = input.integrationRegistry
    .listDefinitions()
    .find(
      (candidate) =>
        candidate.kind === IntegrationKinds.SANDBOX &&
        candidate.sandboxRuntime?.providerId === input.providerId,
    );

  if (definition?.sandboxRuntime === undefined) {
    throw new Error(`Sandbox runtime definition for provider '${input.providerId}' was not found.`);
  }

  return definition.sandboxRuntime.resourceCapabilities;
}
