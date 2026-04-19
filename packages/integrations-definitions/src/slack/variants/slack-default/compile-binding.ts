import {
  resolveRoutePathPrefixFromBaseUrl,
  type CompileBindingInput,
  type CompileBindingResult,
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
            match: "latest_matching_prefix",
            prefix: "slack/",
          },
          asset: {
            kind: "exact",
            fileName: "slack-linux-amd64",
            format: "binary",
          },
          installPath: refs.artifactBinPath("slack"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
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
    artifacts: includesSlackCli ? [createSlackCliArtifact(upstreamBaseUrl)] : [],
    runtimeClients: [],
  };
}
