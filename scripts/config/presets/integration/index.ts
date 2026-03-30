import type { ConfigRecord } from "../development/types.ts";

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

export type IntegrationProviderPreset = {
  defaults: ConfigRecord;
  prunePaths: readonly (readonly string[])[];
  requiredConfigValues: readonly RequiredConfigValue[];
  outputFileName: (typeof IntegrationConfigFileNames)[keyof typeof IntegrationConfigFileNames];
};

const DOCKER_PRESET: IntegrationProviderPreset = {
  defaults: {
    global: {
      env: "development",
      sandbox: {
        provider: IntegrationSandboxProvider.DOCKER,
        gateway_ws_url: "ws://localhost:5202/tunnel/sandbox",
        internal_gateway_ws_url: "ws://data-plane-gateway:5202/tunnel/sandbox",
      },
    },
    apps: {
      data_plane_api: {
        sandbox: {
          docker: {
            socket_path: "/var/run/docker.sock",
          },
        },
      },
      data_plane_worker: {
        sandbox: {
          tokenizer_proxy_egress_base_url: "http://tokenizer-proxy:5205/tokenizer-proxy/egress",
          docker: {
            socket_path: "/var/run/docker.sock",
            traces_endpoint: "http://host.testcontainers.internal:4318/v1/traces",
          },
        },
      },
    },
  },
  prunePaths: [
    ["apps", "data_plane_api", "sandbox", "e2b"],
    ["apps", "data_plane_worker", "sandbox", "e2b"],
  ],
  requiredConfigValues: [],
  outputFileName: IntegrationConfigFileNames.DOCKER,
};

const E2B_PRESET: IntegrationProviderPreset = {
  defaults: {
    global: {
      env: "development",
      sandbox: {
        provider: IntegrationSandboxProvider.E2B,
        gateway_ws_url: "wss://gateway.mistle.example/tunnel/sandbox",
        internal_gateway_ws_url: "wss://gateway.mistle.example/tunnel/sandbox",
      },
    },
    apps: {
      data_plane_api: {
        sandbox: {
          e2b: {
            domain: "e2b.app",
          },
        },
      },
      data_plane_worker: {
        sandbox: {
          tokenizer_proxy_egress_base_url: "https://api.mistle.example/tokenizer-proxy/egress",
          e2b: {
            domain: "e2b.app",
          },
        },
      },
    },
  },
  prunePaths: [
    ["apps", "data_plane_api", "sandbox", "docker"],
    ["apps", "data_plane_worker", "sandbox", "docker"],
  ],
  requiredConfigValues: [
    {
      path: ["apps", "data_plane_api", "sandbox", "e2b", "api_key"],
      envVar: "MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_API_KEY",
    },
    {
      path: ["apps", "data_plane_worker", "sandbox", "e2b", "api_key"],
      envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_API_KEY",
    },
  ],
  outputFileName: IntegrationConfigFileNames.E2B,
};

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

export function getIntegrationProviderPreset(
  provider: IntegrationSandboxProvider,
): IntegrationProviderPreset {
  if (provider === IntegrationSandboxProvider.DOCKER) {
    return DOCKER_PRESET;
  }

  return E2B_PRESET;
}
