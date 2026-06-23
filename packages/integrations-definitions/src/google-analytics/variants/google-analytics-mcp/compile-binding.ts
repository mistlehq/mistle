import type {
  CompileBindingInput,
  CompileBindingResult,
  RuntimeClient,
} from "@mistle/integrations-core";

import { GoogleAnalyticsCredentialSecretTypes, GoogleAnalyticsCredentialSlotKeys } from "./auth.js";
import type { GoogleAnalyticsBindingConfig } from "./binding-config-schema.js";
import type { GoogleAnalyticsTargetConfig } from "./target-config-schema.js";
import { GoogleAnalyticsToolIds } from "./tool-ids.js";

export type GoogleAnalyticsCompileBindingInput = CompileBindingInput<
  GoogleAnalyticsTargetConfig,
  GoogleAnalyticsBindingConfig
>;

const GoogleAnalyticsCliArtifactKey = "google-analytics-cli";
const GoogleAnalyticsCliArtifactName = "Google Analytics CLI";
const ArtifactCommandTimeoutMs = 120_000;
export const GoogleAnalyticsAnalyticsAdminBaseUrl = "https://analyticsadmin.googleapis.com";
export const GoogleAnalyticsAnalyticsDataBaseUrl = "https://analyticsdata.googleapis.com";
export const GoogleAnalyticsMcpHost = "127.0.0.1";
export const GoogleAnalyticsMcpPort = 7347;
export const GoogleAnalyticsMcpEndpoint = "/mcp";
export const GoogleAnalyticsMcpUrl = `http://${GoogleAnalyticsMcpHost}:${String(
  GoogleAnalyticsMcpPort,
)}${GoogleAnalyticsMcpEndpoint}`;
const GoogleAnalyticsMcpClientId = "google-analytics-mcp";
const GoogleAnalyticsMcpProcessKey = "google-analytics-mcp-server";
const GoogleAnalyticsMcpReadinessTimeoutMs = 60_000;
const GoogleAnalyticsMcpProcessStopTimeoutMs = 10_000;
const GoogleAnalyticsMcpProcessStopGracePeriodMs = 2_000;
// Pin exact release tags for sandbox startup to avoid live upstream version
// resolution and the associated rate-limit / availability failures.
const GoogleAnalyticsCliReleaseTag = "ga/v0.1.0";
const GoogleAnalyticsCliLinuxAmd64Sha256 =
  "7509b10c10aba759d01c82bf86ceb25bac60954fc015d22ea076b428b73051a6";

function createGoogleAnalyticsCliArtifact(): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: GoogleAnalyticsCliArtifactKey,
    name: GoogleAnalyticsCliArtifactName,
    env: {
      GA_ANALYTICS_ADMIN_BASE_URL: GoogleAnalyticsAnalyticsAdminBaseUrl,
      GA_ANALYTICS_DATA_BASE_URL: GoogleAnalyticsAnalyticsDataBaseUrl,
    },
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: GoogleAnalyticsCliReleaseTag,
          },
          asset: {
            kind: "exact",
            fileName: "ga-linux-amd64",
            format: "binary",
            sha256: GoogleAnalyticsCliLinuxAmd64Sha256,
          },
          installPath: refs.artifactBinPath("ga"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

function createGoogleAnalyticsMcpRuntimeClient(
  googleAnalyticsCliInstallPath: string,
): RuntimeClient {
  return {
    clientId: GoogleAnalyticsMcpClientId,
    setup: {
      env: {},
      files: [],
    },
    processes: [
      {
        processKey: GoogleAnalyticsMcpProcessKey,
        command: {
          args: [
            googleAnalyticsCliInstallPath,
            "mcp",
            "serve",
            "--addr",
            `${GoogleAnalyticsMcpHost}:${String(GoogleAnalyticsMcpPort)}`,
            "--endpoint",
            GoogleAnalyticsMcpEndpoint,
          ],
        },
        readiness: {
          type: "tcp",
          host: GoogleAnalyticsMcpHost,
          port: GoogleAnalyticsMcpPort,
          timeoutMs: GoogleAnalyticsMcpReadinessTimeoutMs,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: GoogleAnalyticsMcpProcessStopTimeoutMs,
          gracePeriodMs: GoogleAnalyticsMcpProcessStopGracePeriodMs,
        },
      },
    ],
    endpoints: [],
  };
}

export function compileGoogleAnalyticsBinding(
  input: GoogleAnalyticsCompileBindingInput,
): CompileBindingResult {
  const includesGoogleAnalyticsCli = input.binding.config.tools.includes(
    GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_CLI,
  );
  const includesGoogleAnalyticsMcp = input.binding.config.tools.includes(
    GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_MCP,
  );
  const includesGoogleAnalyticsToolArtifact =
    includesGoogleAnalyticsCli || includesGoogleAnalyticsMcp;

  return {
    egressRoutes: [
      {
        match: {
          hosts: ["analyticsadmin.googleapis.com"],
        },
        upstream: {
          baseUrl: GoogleAnalyticsAnalyticsAdminBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: GoogleAnalyticsCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleAnalyticsCredentialSlotKeys.accessToken,
        },
      },
      {
        match: {
          hosts: ["analyticsdata.googleapis.com"],
        },
        upstream: {
          baseUrl: GoogleAnalyticsAnalyticsDataBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: GoogleAnalyticsCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleAnalyticsCredentialSlotKeys.accessToken,
        },
      },
    ],
    artifacts: includesGoogleAnalyticsToolArtifact ? [createGoogleAnalyticsCliArtifact()] : [],
    runtimeClients: includesGoogleAnalyticsMcp
      ? [createGoogleAnalyticsMcpRuntimeClient(input.refs.artifactBinPath("ga"))]
      : [],
  };
}
