import type {
  SandboxProviderSummary,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";

export const DockerSandboxProviderId = "docker";

const E2BSandboxProviderId = "e2b";
const TensorlakeSandboxProviderId = "tensorlake";
const ManagedSandboxProviderPreference = [
  TensorlakeSandboxProviderId,
  E2BSandboxProviderId,
  DockerSandboxProviderId,
] as const;

export type CreateSandboxProfileDefaultRuntimeConfig = {
  sandboxProvider: string;
  sandboxResources: SandboxProfileVersion["sandboxResources"];
};

export function resolveManagedSandboxProvider(
  providers: readonly SandboxProviderSummary[],
): SandboxProviderSummary | undefined {
  const managedProviders = providers.filter((provider) => provider.managed);
  for (const providerId of ManagedSandboxProviderPreference) {
    const provider = managedProviders.find((candidate) => candidate.id === providerId);
    if (provider !== undefined) {
      return provider;
    }
  }

  return managedProviders[0];
}

export function createDefaultSandboxResources(
  provider: SandboxProviderSummary,
): SandboxProfileVersion["sandboxResources"] {
  const capabilities = provider.resourceCapabilities;
  if (capabilities === null) {
    return null;
  }

  return {
    vcpuCount: capabilities.vcpuCount.default,
    memoryMb: capabilities.memoryMb.default,
    ...(capabilities.diskMb === undefined ? {} : { diskMb: capabilities.diskMb.default }),
  };
}

export function createDefaultMistleSandboxRuntimeConfig(
  providers: readonly SandboxProviderSummary[],
): CreateSandboxProfileDefaultRuntimeConfig | undefined {
  const managedProvider = resolveManagedSandboxProvider(providers);
  if (managedProvider === undefined) {
    return undefined;
  }

  return {
    sandboxProvider: managedProvider.id,
    sandboxResources: createDefaultSandboxResources(managedProvider),
  };
}
