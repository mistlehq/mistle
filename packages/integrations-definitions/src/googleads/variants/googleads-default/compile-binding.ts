import type {
  CompileBindingInput,
  CompileBindingResult,
  RuntimeClient,
} from "@mistle/integrations-core";

import {
  GoogleAdsConnectionConfigSchema,
  GoogleAdsDeveloperTokenCredentialSlotKey,
  GoogleAdsCredentialSecretTypes,
  GoogleAdsCredentialSlotKeys,
} from "./auth.js";
import type { GoogleAdsBindingConfig } from "./binding-config-schema.js";
import {
  GoogleAdsTargetConfigSchema,
  resolveGoogleAdsBaseUrl,
  type GoogleAdsTargetConfig,
} from "./target-config-schema.js";
import { GoogleAdsToolIds } from "./tool-ids.js";

export type GoogleAdsCompileBindingInput = CompileBindingInput<
  GoogleAdsTargetConfig,
  GoogleAdsBindingConfig
>;

const GoogleAdsCliArtifactKey = "googleads-cli";
const GoogleAdsCliArtifactName = "Google Ads CLI";
const ArtifactCommandTimeoutMs = 120_000;
export const GoogleAdsMcpHost = "127.0.0.1";
export const GoogleAdsMcpPort = 7352;
export const GoogleAdsMcpEndpoint = "/mcp";
export const GoogleAdsMcpUrl = `http://${GoogleAdsMcpHost}:${String(GoogleAdsMcpPort)}${GoogleAdsMcpEndpoint}`;
const GoogleAdsMcpClientId = "googleads-mcp";
const GoogleAdsMcpProcessKey = "googleads-mcp-server";
const GoogleAdsMcpReadinessTimeoutMs = 60_000;
const GoogleAdsMcpProcessStopTimeoutMs = 10_000;
const GoogleAdsMcpProcessStopGracePeriodMs = 2_000;
// Pin exact release tags for sandbox startup to avoid live upstream version
// resolution and the associated rate-limit / availability failures.
const GoogleAdsCliReleaseTag = "googleads/v0.1.1";
const GoogleAdsCliLinuxAmd64Sha256 =
  "746762382cc808232350eae87818e6d465724a9d070b5b604842be4a9b8c1920";

function createGoogleAdsCliArtifact(baseUrl: string): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: GoogleAdsCliArtifactKey,
    name: GoogleAdsCliArtifactName,
    env: {
      GOOGLEADS_BASE_URL: baseUrl,
    },
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: GoogleAdsCliReleaseTag,
          },
          asset: {
            kind: "exact",
            fileName: "googleads-linux-amd64",
            format: "binary",
            sha256: GoogleAdsCliLinuxAmd64Sha256,
          },
          installPath: refs.artifactBinPath("googleads"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

function createGoogleAdsMcpRuntimeClient(googleAdsCliInstallPath: string): RuntimeClient {
  return {
    clientId: GoogleAdsMcpClientId,
    setup: {
      env: {},
      files: [],
    },
    processes: [
      {
        processKey: GoogleAdsMcpProcessKey,
        command: {
          args: [
            googleAdsCliInstallPath,
            "mcp",
            "serve",
            "--addr",
            `${GoogleAdsMcpHost}:${String(GoogleAdsMcpPort)}`,
            "--endpoint",
            GoogleAdsMcpEndpoint,
          ],
        },
        readiness: {
          type: "tcp",
          host: GoogleAdsMcpHost,
          port: GoogleAdsMcpPort,
          timeoutMs: GoogleAdsMcpReadinessTimeoutMs,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: GoogleAdsMcpProcessStopTimeoutMs,
          gracePeriodMs: GoogleAdsMcpProcessStopGracePeriodMs,
        },
      },
    ],
    endpoints: [],
  };
}

export function compileGoogleAdsBinding(input: GoogleAdsCompileBindingInput): CompileBindingResult {
  const targetConfig = GoogleAdsTargetConfigSchema.parse(input.target.config);
  const baseUrl = resolveGoogleAdsBaseUrl(targetConfig.api_version);
  const parsedBaseUrl = new URL(baseUrl);
  GoogleAdsConnectionConfigSchema.parse(input.connection.config);
  const includesGoogleAdsCli = input.binding.config.tools.includes(GoogleAdsToolIds.GOOGLEADS_CLI);
  const includesGoogleAdsMcp = input.binding.config.tools.includes(GoogleAdsToolIds.GOOGLEADS_MCP);
  const includesGoogleAdsToolArtifact = includesGoogleAdsCli || includesGoogleAdsMcp;

  return {
    egressRoutes: [
      {
        match: {
          hosts: [parsedBaseUrl.host],
          pathPrefixes: [parsedBaseUrl.pathname],
        },
        upstream: {
          baseUrl: baseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: GoogleAdsCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleAdsCredentialSlotKeys.accessToken,
        },
        additionalCredentialHeaders: [
          {
            header: "developer-token",
            credentialResolver: {
              kind: "integration_connection",
              connectionId: input.connection.id,
              secretType: GoogleAdsCredentialSecretTypes.API_KEY,
              slotKey: GoogleAdsDeveloperTokenCredentialSlotKey,
            },
          },
        ],
      },
    ],
    artifacts: includesGoogleAdsToolArtifact ? [createGoogleAdsCliArtifact(baseUrl)] : [],
    runtimeClients: includesGoogleAdsMcp
      ? [createGoogleAdsMcpRuntimeClient(input.refs.artifactBinPath("googleads"))]
      : [],
  };
}
