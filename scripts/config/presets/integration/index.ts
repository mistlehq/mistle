import { getValueAtPath } from "../../../../packages/config/src/core/record.js";
import { resolveLatestPublishedSandboxBaseImageRef } from "../../../../packages/config/src/sandbox-base-images.js";

export const IntegrationSandboxProvider = {
  DOCKER: "docker",
  E2B: "e2b",
} as const;

export type IntegrationSandboxProvider =
  (typeof IntegrationSandboxProvider)[keyof typeof IntegrationSandboxProvider];

export const IntegrationConfigFileNames = {
  DEFAULT: "config.integration.toml",
} as const;

type RequiredConfigValue = {
  path: readonly string[];
  envVar: string;
};

const ArchilIntegrationRequiredConfigValues = [
  {
    path: ["sandbox", "storage", "archil", "api_key"],
    envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY",
  },
  {
    path: ["sandbox", "storage", "archil", "region"],
    envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_REGION",
  },
  {
    path: ["object_store", "sandbox_storage", "bucket_name"],
    envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME",
  },
  {
    path: ["object_store", "sandbox_storage", "endpoint"],
    envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT",
  },
  {
    path: ["object_store", "sandbox_storage", "access_key_id"],
    envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID",
  },
  {
    path: ["object_store", "sandbox_storage", "secret_access_key"],
    envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY",
  },
] as const satisfies readonly RequiredConfigValue[];

export type IntegrationProviderPreset = {
  requiredConfigValues: readonly RequiredConfigValue[];
  e2bSandboxBaseImage?: string;
};

const DOCKER_PRESET: IntegrationProviderPreset = {
  requiredConfigValues: [],
};

const E2B_REQUIRED_CONFIG_VALUES = [
  {
    path: ["sandbox", "e2b", "api_key"],
    envVar: "MISTLE_SANDBOX_E2B_API_KEY",
  },
] as const satisfies readonly RequiredConfigValue[];

async function createE2BPreset(): Promise<IntegrationProviderPreset> {
  const e2bIntegrationSandboxBaseImage = await resolveLatestPublishedSandboxBaseImageRef();

  return {
    requiredConfigValues: E2B_REQUIRED_CONFIG_VALUES,
    e2bSandboxBaseImage: e2bIntegrationSandboxBaseImage,
  };
}

export function getRequiredIntegrationConfigValues(input: {
  providers: readonly IntegrationSandboxProvider[];
  configRoot: Record<string, unknown>;
}): readonly RequiredConfigValue[] {
  const presetRequiredConfigValues = input.providers.includes(IntegrationSandboxProvider.E2B)
    ? E2B_REQUIRED_CONFIG_VALUES
    : [];
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
