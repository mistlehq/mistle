import type {
  CompileBindingInput,
  CompileBindingResult,
  RuntimeClient,
} from "@mistle/integrations-core";

import { MetaAdsCredentialSecretTypes, MetaAdsCredentialSlotKeys } from "./auth.js";
import type { MetaAdsBindingConfig } from "./binding-config-schema.js";
import {
  MetaAdsTargetConfigSchema,
  resolveMetaAdsGraphBaseUrl,
  type MetaAdsTargetConfig,
} from "./target-config-schema.js";
import { MetaAdsToolIds } from "./tool-ids.js";

export type MetaAdsCompileBindingInput = CompileBindingInput<
  MetaAdsTargetConfig,
  MetaAdsBindingConfig
>;

const MetaAdsCliArtifactKey = "metaads-cli";
const MetaAdsCliArtifactName = "Meta Ads CLI";
const ArtifactCommandTimeoutMs = 120_000;
export const MetaAdsMcpHost = "127.0.0.1";
export const MetaAdsMcpPort = 7350;
export const MetaAdsMcpEndpoint = "/mcp";
export const MetaAdsMcpUrl = `http://${MetaAdsMcpHost}:${String(MetaAdsMcpPort)}${MetaAdsMcpEndpoint}`;
const MetaAdsMcpClientId = "metaads-mcp";
const MetaAdsMcpProcessKey = "metaads-mcp-server";
const MetaAdsMcpReadinessTimeoutMs = 60_000;
const MetaAdsMcpProcessStopTimeoutMs = 10_000;
const MetaAdsMcpProcessStopGracePeriodMs = 2_000;
// Pin exact release tags for sandbox startup to avoid live upstream version
// resolution and the associated rate-limit / availability failures.
const MetaAdsCliReleaseTag = "metaads/v0.1.0";
const MetaAdsCliLinuxAmd64Sha256 =
  "969a6bc0c96f510cadb3a13f358f9347a6df0dbcad5c3bbd052c1758b3e278e3";

function createMetaAdsCliArtifact(graphBaseUrl: string): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: MetaAdsCliArtifactKey,
    name: MetaAdsCliArtifactName,
    env: {
      METAADS_GRAPH_BASE_URL: graphBaseUrl,
    },
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: MetaAdsCliReleaseTag,
          },
          asset: {
            kind: "exact",
            fileName: "metaads-linux-amd64",
            format: "binary",
            sha256: MetaAdsCliLinuxAmd64Sha256,
          },
          installPath: refs.artifactBinPath("metaads"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

function createMetaAdsMcpRuntimeClient(metaAdsCliInstallPath: string): RuntimeClient {
  return {
    clientId: MetaAdsMcpClientId,
    setup: {
      env: {},
      files: [],
    },
    processes: [
      {
        processKey: MetaAdsMcpProcessKey,
        command: {
          args: [
            metaAdsCliInstallPath,
            "mcp",
            "serve",
            "--addr",
            `${MetaAdsMcpHost}:${String(MetaAdsMcpPort)}`,
            "--endpoint",
            MetaAdsMcpEndpoint,
          ],
        },
        readiness: {
          type: "tcp",
          host: MetaAdsMcpHost,
          port: MetaAdsMcpPort,
          timeoutMs: MetaAdsMcpReadinessTimeoutMs,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: MetaAdsMcpProcessStopTimeoutMs,
          gracePeriodMs: MetaAdsMcpProcessStopGracePeriodMs,
        },
      },
    ],
    endpoints: [],
  };
}

export function compileMetaAdsBinding(input: MetaAdsCompileBindingInput): CompileBindingResult {
  const targetConfig = MetaAdsTargetConfigSchema.parse(input.target.config);
  const graphBaseUrl = resolveMetaAdsGraphBaseUrl(targetConfig.graph_api_version);
  const parsedGraphBaseUrl = new URL(graphBaseUrl);
  const includesMetaAdsCli = input.binding.config.tools.includes(MetaAdsToolIds.METAADS_CLI);
  const includesMetaAdsMcp = input.binding.config.tools.includes(MetaAdsToolIds.METAADS_MCP);
  const includesMetaAdsToolArtifact = includesMetaAdsCli || includesMetaAdsMcp;

  return {
    egressRoutes: [
      {
        match: {
          hosts: [parsedGraphBaseUrl.host],
          pathPrefixes: [parsedGraphBaseUrl.pathname],
        },
        upstream: {
          baseUrl: graphBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: MetaAdsCredentialSecretTypes.API_KEY,
          slotKey: MetaAdsCredentialSlotKeys.ACCESS_TOKEN,
        },
      },
    ],
    artifacts: includesMetaAdsToolArtifact ? [createMetaAdsCliArtifact(graphBaseUrl)] : [],
    runtimeClients: includesMetaAdsMcp
      ? [createMetaAdsMcpRuntimeClient(input.refs.artifactBinPath("metaads"))]
      : [],
  };
}
