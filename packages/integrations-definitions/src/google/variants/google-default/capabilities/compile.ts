import {
  IntegrationMcpTransports,
  type CompileBindingInput,
  type CompileBindingResult,
  type EgressCredentialResolverRef,
  type IntegrationMcpServer,
  type RuntimeClient,
} from "@mistle/integrations-core";

import {
  GcpMcpServerCatalog,
  GcpMcpServerIds,
} from "../../../../gcp/variants/gcp-mcp/mcp-catalog.js";
import {
  GoogleAnalyticsAnalyticsAdminBaseUrl,
  GoogleAnalyticsAnalyticsDataBaseUrl,
  GoogleAnalyticsMcpEndpoint,
  GoogleAnalyticsMcpHost,
  GoogleAnalyticsMcpPort,
  GoogleAnalyticsMcpUrl,
} from "../../../../google-analytics/variants/google-analytics-mcp/compile-binding.js";
import {
  GoogleBusinessProfileAccountManagementBaseUrl,
  GoogleBusinessProfileBusinessInformationBaseUrl,
  GoogleBusinessProfileMcpEndpoint,
  GoogleBusinessProfileMcpHost,
  GoogleBusinessProfileMcpPort,
  GoogleBusinessProfileMcpUrl,
  GoogleBusinessProfileMyBusinessBaseUrl,
  GoogleBusinessProfilePerformanceBaseUrl,
} from "../../../../google-business-profile/variants/google-business-profile-mcp/compile-binding.js";
import {
  GoogleSearchConsoleBaseUrl,
  GoogleSearchConsoleMcpEndpoint,
  GoogleSearchConsoleMcpHost,
  GoogleSearchConsoleMcpPort,
  GoogleSearchConsoleMcpUrl,
} from "../../../../google-search-console/variants/google-search-console-mcp/compile-binding.js";
import {
  compileRemoteMcpServerEgressRoutes,
  resolveRemoteMcpServers,
} from "../../../../shared/remote-mcp-server-catalog/index.js";
import { GoogleCredentialSecretTypes, GoogleOAuthCredentialSlotKeys } from "../auth.js";
import type { GoogleBindingConfig } from "../binding-config-schema.js";
import type { GoogleTargetConfig } from "../target-config-schema.js";
import type { GoogleTargetSecrets } from "../target-secret-schema.js";
import { GoogleCapabilityIds } from "./catalog.js";

export type GoogleCompileBindingInput = CompileBindingInput<
  GoogleTargetConfig,
  GoogleBindingConfig,
  GoogleTargetSecrets
>;

const ArtifactCommandTimeoutMs = 120_000;
const McpReadinessTimeoutMs = 60_000;
const McpProcessStopTimeoutMs = 10_000;
const McpProcessStopGracePeriodMs = 2_000;

const GoogleAnalyticsCliReleaseTag = "ga/v0.1.0";
const GoogleAnalyticsCliLinuxAmd64Sha256 =
  "7509b10c10aba759d01c82bf86ceb25bac60954fc015d22ea076b428b73051a6";
const GoogleSearchConsoleCliReleaseTag = "gsc/v0.1.0";
const GoogleSearchConsoleCliLinuxAmd64Sha256 =
  "f98c3a993a23e05987d064c8e27004c28eb56e1e47cfbc93a689cd2a70e588f8";
const GoogleBusinessProfileCliReleaseTag = "gbp/v0.1.0";
const GoogleBusinessProfileCliLinuxAmd64Sha256 =
  "f8315afce769c07840f767152a3a3587f8e1b30117033b73fa135b43c6910e16";

type GoogleCapabilityCompileContext = {
  input: GoogleCompileBindingInput;
  selectedCapabilities: ReadonlySet<string>;
};

type LocalMcpCapabilityConfig = {
  artifactKey: string;
  artifactName: string;
  binaryName: string;
  clientId: string;
  description: string;
  env: Record<string, string>;
  executableName: string;
  linuxAmd64Sha256: string;
  mcpEndpoint: string;
  mcpHost: string;
  mcpPort: number;
  mcpUrl: string;
  processKey: string;
  releaseTag: string;
  serverId: string;
  serverName: string;
};

const GoogleAnalyticsLocalMcpConfig: LocalMcpCapabilityConfig = {
  artifactKey: "google-analytics-cli",
  artifactName: "Google Analytics CLI",
  binaryName: "ga-linux-amd64",
  clientId: "google-analytics-mcp",
  description: "Google Analytics MCP",
  env: {
    GA_ANALYTICS_ADMIN_BASE_URL: GoogleAnalyticsAnalyticsAdminBaseUrl,
    GA_ANALYTICS_DATA_BASE_URL: GoogleAnalyticsAnalyticsDataBaseUrl,
  },
  executableName: "ga",
  linuxAmd64Sha256: GoogleAnalyticsCliLinuxAmd64Sha256,
  mcpEndpoint: GoogleAnalyticsMcpEndpoint,
  mcpHost: GoogleAnalyticsMcpHost,
  mcpPort: GoogleAnalyticsMcpPort,
  mcpUrl: GoogleAnalyticsMcpUrl,
  processKey: "google-analytics-mcp-server",
  releaseTag: GoogleAnalyticsCliReleaseTag,
  serverId: "google-analytics-mcp",
  serverName: "google_analytics",
};

const GoogleSearchConsoleLocalMcpConfig: LocalMcpCapabilityConfig = {
  artifactKey: "google-search-console-cli",
  artifactName: "Google Search Console CLI",
  binaryName: "gsc-linux-amd64",
  clientId: "google-search-console-mcp",
  description: "Google Search Console MCP",
  env: {
    GSC_SEARCH_CONSOLE_BASE_URL: GoogleSearchConsoleBaseUrl,
  },
  executableName: "gsc",
  linuxAmd64Sha256: GoogleSearchConsoleCliLinuxAmd64Sha256,
  mcpEndpoint: GoogleSearchConsoleMcpEndpoint,
  mcpHost: GoogleSearchConsoleMcpHost,
  mcpPort: GoogleSearchConsoleMcpPort,
  mcpUrl: GoogleSearchConsoleMcpUrl,
  processKey: "google-search-console-mcp-server",
  releaseTag: GoogleSearchConsoleCliReleaseTag,
  serverId: "google-search-console-mcp",
  serverName: "google_search_console",
};

const GoogleBusinessProfileLocalMcpConfig: LocalMcpCapabilityConfig = {
  artifactKey: "google-business-profile-cli",
  artifactName: "Google Business Profile CLI",
  binaryName: "gbp-linux-amd64",
  clientId: "google-business-profile-mcp",
  description: "Google Business Profile MCP",
  env: {
    GBP_ACCOUNT_MANAGEMENT_BASE_URL: GoogleBusinessProfileAccountManagementBaseUrl,
    GBP_BUSINESS_INFORMATION_BASE_URL: GoogleBusinessProfileBusinessInformationBaseUrl,
    GBP_MYBUSINESS_BASE_URL: GoogleBusinessProfileMyBusinessBaseUrl,
    GBP_PERFORMANCE_BASE_URL: GoogleBusinessProfilePerformanceBaseUrl,
  },
  executableName: "gbp",
  linuxAmd64Sha256: GoogleBusinessProfileCliLinuxAmd64Sha256,
  mcpEndpoint: GoogleBusinessProfileMcpEndpoint,
  mcpHost: GoogleBusinessProfileMcpHost,
  mcpPort: GoogleBusinessProfileMcpPort,
  mcpUrl: GoogleBusinessProfileMcpUrl,
  processKey: "google-business-profile-mcp-server",
  releaseTag: GoogleBusinessProfileCliReleaseTag,
  serverId: "google-business-profile-mcp",
  serverName: "google_business_profile",
};

export function compileGoogleCapabilities(input: GoogleCompileBindingInput): CompileBindingResult {
  const selectedCapabilities = new Set(input.binding.config.capabilities);
  const context: GoogleCapabilityCompileContext = { input, selectedCapabilities };

  return mergeCompileBindingResults([
    compileGoogleAnalyticsCapability(context),
    compileGoogleSearchConsoleCapability(context),
    compileGoogleBusinessProfileCapability(context),
    compileGoogleCloudCapabilities(context),
  ]);
}

export function resolveGoogleCapabilityMcpServers(
  input: GoogleCompileBindingInput,
): readonly IntegrationMcpServer[] {
  const selectedCapabilities = new Set(input.binding.config.capabilities);

  return [
    ...resolveLocalCapabilityMcpServers(selectedCapabilities),
    ...resolveGoogleCloudMcpServers(selectedCapabilities),
  ];
}

function compileGoogleAnalyticsCapability(
  context: GoogleCapabilityCompileContext,
): CompileBindingResult {
  if (!context.selectedCapabilities.has(GoogleCapabilityIds.GOOGLE_ANALYTICS)) {
    return emptyCompileBindingResult();
  }

  return {
    egressRoutes: [
      createBearerEgressRoute({
        baseUrl: GoogleAnalyticsAnalyticsAdminBaseUrl,
        connectionId: context.input.connection.id,
        host: "analyticsadmin.googleapis.com",
      }),
      createBearerEgressRoute({
        baseUrl: GoogleAnalyticsAnalyticsDataBaseUrl,
        connectionId: context.input.connection.id,
        host: "analyticsdata.googleapis.com",
      }),
    ],
    artifacts: [createLocalMcpCliArtifact(GoogleAnalyticsLocalMcpConfig)],
    runtimeClients: [
      createLocalMcpRuntimeClient({
        config: GoogleAnalyticsLocalMcpConfig,
        installPath: context.input.refs.artifactBinPath(
          GoogleAnalyticsLocalMcpConfig.executableName,
        ),
      }),
    ],
  };
}

function compileGoogleSearchConsoleCapability(
  context: GoogleCapabilityCompileContext,
): CompileBindingResult {
  if (!context.selectedCapabilities.has(GoogleCapabilityIds.GOOGLE_SEARCH_CONSOLE)) {
    return emptyCompileBindingResult();
  }

  return {
    egressRoutes: [
      createBearerEgressRoute({
        baseUrl: GoogleSearchConsoleBaseUrl,
        connectionId: context.input.connection.id,
        host: "searchconsole.googleapis.com",
      }),
    ],
    artifacts: [createLocalMcpCliArtifact(GoogleSearchConsoleLocalMcpConfig)],
    runtimeClients: [
      createLocalMcpRuntimeClient({
        config: GoogleSearchConsoleLocalMcpConfig,
        installPath: context.input.refs.artifactBinPath(
          GoogleSearchConsoleLocalMcpConfig.executableName,
        ),
      }),
    ],
  };
}

function compileGoogleBusinessProfileCapability(
  context: GoogleCapabilityCompileContext,
): CompileBindingResult {
  if (!context.selectedCapabilities.has(GoogleCapabilityIds.GOOGLE_BUSINESS_PROFILE)) {
    return emptyCompileBindingResult();
  }

  return {
    egressRoutes: [
      createBearerEgressRoute({
        baseUrl: GoogleBusinessProfileAccountManagementBaseUrl,
        connectionId: context.input.connection.id,
        host: "mybusinessaccountmanagement.googleapis.com",
      }),
      createBearerEgressRoute({
        baseUrl: GoogleBusinessProfileBusinessInformationBaseUrl,
        connectionId: context.input.connection.id,
        host: "mybusinessbusinessinformation.googleapis.com",
      }),
      createBearerEgressRoute({
        baseUrl: GoogleBusinessProfilePerformanceBaseUrl,
        connectionId: context.input.connection.id,
        host: "businessprofileperformance.googleapis.com",
      }),
      createBearerEgressRoute({
        baseUrl: GoogleBusinessProfileMyBusinessBaseUrl,
        connectionId: context.input.connection.id,
        host: "mybusiness.googleapis.com",
      }),
    ],
    artifacts: [createLocalMcpCliArtifact(GoogleBusinessProfileLocalMcpConfig)],
    runtimeClients: [
      createLocalMcpRuntimeClient({
        config: GoogleBusinessProfileLocalMcpConfig,
        installPath: context.input.refs.artifactBinPath(
          GoogleBusinessProfileLocalMcpConfig.executableName,
        ),
      }),
    ],
  };
}

function compileGoogleCloudCapabilities(
  context: GoogleCapabilityCompileContext,
): CompileBindingResult {
  const selectedGoogleCloudMcpServerIds = resolveSelectedGoogleCloudMcpServerIds(
    context.selectedCapabilities,
  );
  if (selectedGoogleCloudMcpServerIds.length === 0) {
    return emptyCompileBindingResult();
  }

  return {
    egressRoutes: compileRemoteMcpServerEgressRoutes({
      catalog: GcpMcpServerCatalog,
      selectedIds: selectedGoogleCloudMcpServerIds,
      authInjection: {
        type: "bearer",
        target: "authorization",
      },
      credentialResolver: createGoogleConnectionAccessTokenResolver(context.input.connection.id),
    }),
    artifacts: [],
    runtimeClients: [],
  };
}

function resolveLocalCapabilityMcpServers(
  selectedCapabilities: ReadonlySet<string>,
): readonly IntegrationMcpServer[] {
  const servers: IntegrationMcpServer[] = [];

  if (selectedCapabilities.has(GoogleCapabilityIds.GOOGLE_ANALYTICS)) {
    servers.push(createLocalMcpServer(GoogleAnalyticsLocalMcpConfig));
  }
  if (selectedCapabilities.has(GoogleCapabilityIds.GOOGLE_SEARCH_CONSOLE)) {
    servers.push(createLocalMcpServer(GoogleSearchConsoleLocalMcpConfig));
  }
  if (selectedCapabilities.has(GoogleCapabilityIds.GOOGLE_BUSINESS_PROFILE)) {
    servers.push(createLocalMcpServer(GoogleBusinessProfileLocalMcpConfig));
  }

  return servers;
}

function resolveGoogleCloudMcpServers(
  selectedCapabilities: ReadonlySet<string>,
): readonly IntegrationMcpServer[] {
  const selectedGoogleCloudMcpServerIds =
    resolveSelectedGoogleCloudMcpServerIds(selectedCapabilities);

  return resolveRemoteMcpServers({
    catalog: GcpMcpServerCatalog,
    selectedIds: selectedGoogleCloudMcpServerIds,
  });
}

function resolveSelectedGoogleCloudMcpServerIds(
  selectedCapabilities: ReadonlySet<string>,
): readonly string[] {
  const selectedIds: string[] = [];

  if (selectedCapabilities.has(GoogleCapabilityIds.GCP_CLOUD_LOGGING)) {
    selectedIds.push(GcpMcpServerIds.CLOUD_LOGGING);
  }
  if (selectedCapabilities.has(GoogleCapabilityIds.GCP_CLOUD_RUN)) {
    selectedIds.push(GcpMcpServerIds.CLOUD_RUN);
  }
  if (selectedCapabilities.has(GoogleCapabilityIds.GCP_CLOUD_STORAGE)) {
    selectedIds.push(GcpMcpServerIds.CLOUD_STORAGE);
  }
  if (selectedCapabilities.has(GoogleCapabilityIds.GCP_CLOUD_RESOURCE_MANAGER)) {
    selectedIds.push(GcpMcpServerIds.CLOUD_RESOURCE_MANAGER);
  }
  if (selectedCapabilities.has(GoogleCapabilityIds.GCP_GKE)) {
    selectedIds.push(GcpMcpServerIds.GKE);
  }

  return selectedIds;
}

function createLocalMcpServer(config: LocalMcpCapabilityConfig): IntegrationMcpServer {
  return {
    serverId: config.serverId,
    serverName: config.serverName,
    transport: IntegrationMcpTransports.STREAMABLE_HTTP,
    url: config.mcpUrl,
    description: config.description,
  };
}

function createLocalMcpCliArtifact(
  config: LocalMcpCapabilityConfig,
): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: config.artifactKey,
    name: config.artifactName,
    env: config.env,
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: config.releaseTag,
          },
          asset: {
            kind: "exact",
            fileName: config.binaryName,
            format: "binary",
            sha256: config.linuxAmd64Sha256,
          },
          installPath: refs.artifactBinPath(config.executableName),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

function createLocalMcpRuntimeClient(input: {
  config: LocalMcpCapabilityConfig;
  installPath: string;
}): RuntimeClient {
  return {
    clientId: input.config.clientId,
    setup: {
      env: {},
      files: [],
    },
    processes: [
      {
        processKey: input.config.processKey,
        command: {
          args: [
            input.installPath,
            "mcp",
            "serve",
            "--addr",
            `${input.config.mcpHost}:${String(input.config.mcpPort)}`,
            "--endpoint",
            input.config.mcpEndpoint,
          ],
        },
        readiness: {
          type: "tcp",
          host: input.config.mcpHost,
          port: input.config.mcpPort,
          timeoutMs: McpReadinessTimeoutMs,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: McpProcessStopTimeoutMs,
          gracePeriodMs: McpProcessStopGracePeriodMs,
        },
      },
    ],
    endpoints: [],
  };
}

function createBearerEgressRoute(input: {
  baseUrl: string;
  connectionId: string;
  host: string;
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: [input.host],
    },
    upstream: {
      baseUrl: input.baseUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: createGoogleConnectionAccessTokenResolver(input.connectionId),
  };
}

function createGoogleConnectionAccessTokenResolver(
  connectionId: string,
): EgressCredentialResolverRef {
  return {
    kind: "integration_connection",
    connectionId,
    secretType: GoogleCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
    slotKey: GoogleOAuthCredentialSlotKeys.accessToken,
  };
}

function mergeCompileBindingResults(
  results: readonly CompileBindingResult[],
): CompileBindingResult {
  return {
    egressRoutes: results.flatMap((result) => result.egressRoutes),
    artifacts: results.flatMap((result) => result.artifacts),
    runtimeClients: results.flatMap((result) => result.runtimeClients),
  };
}

function emptyCompileBindingResult(): CompileBindingResult {
  return {
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
  };
}
