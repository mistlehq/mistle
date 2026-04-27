import { getValueAtPath } from "../../../../packages/config/src/core/record.js";
import { resolveLatestPublishedSandboxBaseImageRef } from "../../../../packages/config/src/sandbox-base-images.js";

export const IntegrationSandboxProvider = {
  DOCKER: "docker",
  E2B: "e2b",
} as const;

export type IntegrationSandboxProvider =
  (typeof IntegrationSandboxProvider)[keyof typeof IntegrationSandboxProvider];

export const IntegrationConfigFileNames = {
  DOCKER: "config.integration.docker.toml",
  E2B: "config.integration.e2b.toml",
} as const;

type RequiredConfigValue = {
  path: readonly string[];
  envVar: string;
};

const ArchilIntegrationRequiredConfigValues = [
  {
    path: ["sandbox", "storage", "archil", "api_key"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_API_KEY",
  },
  {
    path: ["sandbox", "storage", "archil", "region"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_REGION",
  },
  {
    path: ["object_store", "sandbox_storage", "bucket_name"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON",
  },
  {
    path: ["object_store", "sandbox_storage", "endpoint"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON",
  },
  {
    path: ["object_store", "sandbox_storage", "access_key_id"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON",
  },
  {
    path: ["object_store", "sandbox_storage", "secret_access_key"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON",
  },
] as const satisfies readonly RequiredConfigValue[];

export type IntegrationProviderPreset = {
  requiredConfigValues: readonly RequiredConfigValue[];
  outputFileName: (typeof IntegrationConfigFileNames)[keyof typeof IntegrationConfigFileNames];
  e2bSandboxBaseImage?: string;
};

const DOCKER_PRESET: IntegrationProviderPreset = {
  requiredConfigValues: [],
  outputFileName: IntegrationConfigFileNames.DOCKER,
};

const E2B_REQUIRED_CONFIG_VALUES = [
  {
    path: ["sandbox", "e2b", "api_key"],
    envVar: "MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_API_KEY",
  },
  {
    path: ["sandbox", "e2b", "api_key"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_API_KEY",
  },
] as const satisfies readonly RequiredConfigValue[];

async function createE2BPreset(): Promise<IntegrationProviderPreset> {
  const e2bIntegrationSandboxBaseImage = await resolveLatestPublishedSandboxBaseImageRef();

  return {
    requiredConfigValues: E2B_REQUIRED_CONFIG_VALUES,
    outputFileName: IntegrationConfigFileNames.E2B,
    e2bSandboxBaseImage: e2bIntegrationSandboxBaseImage,
  };
}

export function getRequiredIntegrationConfigValues(input: {
  provider: IntegrationSandboxProvider;
  configRoot: Record<string, unknown>;
}): readonly RequiredConfigValue[] {
  const presetRequiredConfigValues =
    input.provider === IntegrationSandboxProvider.E2B ? E2B_REQUIRED_CONFIG_VALUES : [];
  const storageBackend = getValueAtPath(input.configRoot, ["sandbox", "storage", "backend"]);

  if (storageBackend === "archil") {
    return [...presetRequiredConfigValues, ...ArchilIntegrationRequiredConfigValues];
  }

  return presetRequiredConfigValues;
}

export function parseIntegrationSandboxProviders(
  rawProviders: string | undefined,
): readonly IntegrationSandboxProvider[] {
  if (rawProviders === undefined || rawProviders.trim().length === 0) {
    throw new Error(
      "MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS is required for `pnpm config:init:integration`.",
    );
  }

  const providers = new Set<IntegrationSandboxProvider>();

  for (const rawProvider of rawProviders.split(",")) {
    const provider = rawProvider.trim();
    if (provider.length === 0) {
      continue;
    }

    if (provider === IntegrationSandboxProvider.DOCKER) {
      providers.add(provider);
      continue;
    }

    if (provider === IntegrationSandboxProvider.E2B) {
      providers.add(provider);
      continue;
    }

    throw new Error(
      `Unsupported provider "${provider}" in MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS.`,
    );
  }

  if (providers.size === 0) {
    throw new Error(
      "MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS must include at least one supported provider.",
    );
  }

  return [...providers];
}

export async function getIntegrationProviderPreset(
  provider: IntegrationSandboxProvider,
): Promise<IntegrationProviderPreset> {
  if (provider === IntegrationSandboxProvider.DOCKER) {
    return DOCKER_PRESET;
  }

  return createE2BPreset();
}
