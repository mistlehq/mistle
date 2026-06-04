import {
  resolveRoutePathPrefixFromBaseUrl,
  type CompileBindingInput,
  type CompileBindingResult,
  type RuntimeClient,
} from "@mistle/integrations-core";

import { SlackCredentialSecretTypes, SlackCredentialSlotKeys } from "./auth.js";
import type { SlackBindingConfig } from "./binding-config-schema.js";
import { SlackRequestMiddlewareIds } from "./egress-request-middleware.js";
import type { SlackTargetConfig } from "./target-config-schema.js";
import { SlackToolIds } from "./tool-ids.js";

export type SlackCompileBindingInput = CompileBindingInput<SlackTargetConfig, SlackBindingConfig>;

const SlackCliArtifactKey = "slack-cli";
const SlackCliArtifactName = "Slack CLI";
const ArtifactCommandTimeoutMs = 120_000;
export const SlackMcpHost = "127.0.0.1";
export const SlackMcpPort = 7346;
export const SlackMcpEndpoint = "/mcp";
export const SlackMcpUrl = `http://${SlackMcpHost}:${String(SlackMcpPort)}${SlackMcpEndpoint}`;
const SlackMcpClientId = "slack-mcp";
const SlackMcpProcessKey = "slack-mcp-server";
const SlackMcpReadinessTimeoutMs = 60_000;
const SlackMcpProcessStopTimeoutMs = 10_000;
const SlackMcpProcessStopGracePeriodMs = 2_000;
// Pin exact release tags for sandbox startup to avoid live upstream version
// resolution and the associated rate-limit / availability failures.
const SlackCliReleaseTag = "slack/v0.4.0";
const SlackCliLinuxAmd64Sha256 = "1424d32aad0e8f5cd82bdbbeb47f112b1ecd84a78caaea9bf1dff77744647424";

function createSlackCliArtifact(
  upstreamBaseUrl: string,
): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: SlackCliArtifactKey,
    name: SlackCliArtifactName,
    env: {
      SLACK_BASE_URL: upstreamBaseUrl,
    },
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: SlackCliReleaseTag,
          },
          asset: {
            kind: "exact",
            fileName: "slack-linux-amd64",
            format: "binary",
            sha256: SlackCliLinuxAmd64Sha256,
          },
          installPath: refs.artifactBinPath("slack"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

function createSlackMcpRuntimeClient(slackCliInstallPath: string): RuntimeClient {
  return {
    clientId: SlackMcpClientId,
    setup: {
      env: {},
      files: [],
    },
    processes: [
      {
        processKey: SlackMcpProcessKey,
        command: {
          args: [
            slackCliInstallPath,
            "mcp",
            "serve",
            "--addr",
            `${SlackMcpHost}:${String(SlackMcpPort)}`,
            "--endpoint",
            SlackMcpEndpoint,
          ],
        },
        readiness: {
          type: "tcp",
          host: SlackMcpHost,
          port: SlackMcpPort,
          timeoutMs: SlackMcpReadinessTimeoutMs,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: SlackMcpProcessStopTimeoutMs,
          gracePeriodMs: SlackMcpProcessStopGracePeriodMs,
        },
      },
    ],
    endpoints: [],
  };
}

function resolveMatchFromBaseUrl(baseUrl: string): {
  hosts: string[];
  pathPrefixes?: string[];
} {
  const parsedBaseUrl = new URL(baseUrl);
  const pathPrefix = resolveRoutePathPrefixFromBaseUrl(baseUrl);

  if (pathPrefix === "/") {
    return {
      hosts: [parsedBaseUrl.host],
    };
  }

  return {
    hosts: [parsedBaseUrl.host],
    pathPrefixes: [pathPrefix],
  };
}

export function compileSlackBinding(input: SlackCompileBindingInput): CompileBindingResult {
  const includesSlackCli = input.binding.config.tools.includes(SlackToolIds.SLACK_CLI);
  const includesSlackMcp = input.binding.config.tools.includes(SlackToolIds.SLACK_MCP);
  const includesSlackToolArtifact = includesSlackCli || includesSlackMcp;
  const upstreamBaseUrl = input.target.config.apiBaseUrl;

  return {
    egressRoutes: [
      {
        match: resolveMatchFromBaseUrl(upstreamBaseUrl),
        upstream: {
          baseUrl: upstreamBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: SlackCredentialSecretTypes.API_KEY,
          slotKey: SlackCredentialSlotKeys.BOT_TOKEN,
        },
        requestMiddleware: [SlackRequestMiddlewareIds.APPEND_SESSION_LINK_TO_TEXT],
      },
    ],
    artifacts: includesSlackToolArtifact ? [createSlackCliArtifact(upstreamBaseUrl)] : [],
    runtimeClients: includesSlackMcp
      ? [createSlackMcpRuntimeClient(input.refs.artifactBinPath("slack"))]
      : [],
  };
}
