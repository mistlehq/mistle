import {
  resolveRoutePathPrefixFromBaseUrl,
  type CompileBindingInput,
  type CompileBindingResult,
  type RuntimeClient,
} from "@mistle/integrations-core";

import { DiscordCredentialSecretTypes, DiscordCredentialSlotKeys } from "./auth.js";
import type { DiscordBindingConfig } from "./binding-config-schema.js";
import type { DiscordTargetConfig } from "./target-config-schema.js";
import { DiscordToolIds } from "./tool-ids.js";

export type DiscordCompileBindingInput = CompileBindingInput<
  DiscordTargetConfig,
  DiscordBindingConfig
>;

const DiscordCliArtifactKey = "discord-cli";
const DiscordCliArtifactName = "Discord CLI";
const ArtifactCommandTimeoutMs = 120_000;
export const DiscordMcpHost = "127.0.0.1";
export const DiscordMcpPort = 7356;
export const DiscordMcpEndpoint = "/mcp";
export const DiscordMcpUrl = `http://${DiscordMcpHost}:${String(DiscordMcpPort)}${DiscordMcpEndpoint}`;
const DiscordMcpClientId = "discord-mcp";
const DiscordMcpProcessKey = "discord-mcp-server";
const DiscordMcpReadinessTimeoutMs = 60_000;
const DiscordMcpProcessStopTimeoutMs = 10_000;
const DiscordMcpProcessStopGracePeriodMs = 2_000;
const DiscordCliReleaseTag = "discord/v0.1.0";
const DiscordCliLinuxAmd64Sha256 =
  "fea80f719c6065e298d8b7673c00e8b4091675e4afa6150db843cc4591c2359b";

function createDiscordCliArtifact(
  upstreamBaseUrl: string,
): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: DiscordCliArtifactKey,
    name: DiscordCliArtifactName,
    env: {
      DISCORD_BASE_URL: upstreamBaseUrl,
    },
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: DiscordCliReleaseTag,
          },
          asset: {
            kind: "exact",
            fileName: "discord-linux-amd64",
            format: "binary",
            sha256: DiscordCliLinuxAmd64Sha256,
          },
          installPath: refs.artifactBinPath("discord"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

function createDiscordMcpRuntimeClient(discordCliInstallPath: string): RuntimeClient {
  return {
    clientId: DiscordMcpClientId,
    setup: {
      env: {},
      files: [],
    },
    processes: [
      {
        processKey: DiscordMcpProcessKey,
        command: {
          args: [
            discordCliInstallPath,
            "mcp",
            "serve",
            "--addr",
            `${DiscordMcpHost}:${String(DiscordMcpPort)}`,
            "--endpoint",
            DiscordMcpEndpoint,
          ],
        },
        readiness: {
          type: "tcp",
          host: DiscordMcpHost,
          port: DiscordMcpPort,
          timeoutMs: DiscordMcpReadinessTimeoutMs,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: DiscordMcpProcessStopTimeoutMs,
          gracePeriodMs: DiscordMcpProcessStopGracePeriodMs,
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

export function compileDiscordBinding(input: DiscordCompileBindingInput): CompileBindingResult {
  const includesDiscordCli = input.binding.config.tools.includes(DiscordToolIds.DISCORD_CLI);
  const includesDiscordMcp = input.binding.config.tools.includes(DiscordToolIds.DISCORD_MCP);
  const includesDiscordToolArtifact = includesDiscordCli || includesDiscordMcp;
  const upstreamBaseUrl = input.target.config.apiBaseUrl;

  return {
    egressRoutes: [
      {
        match: resolveMatchFromBaseUrl(upstreamBaseUrl),
        upstream: {
          baseUrl: upstreamBaseUrl,
        },
        authInjection: {
          type: "header",
          target: "authorization",
          credentialPrefix: "Bot ",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: DiscordCredentialSecretTypes.API_KEY,
          slotKey: DiscordCredentialSlotKeys.BOT_TOKEN,
        },
      },
    ],
    artifacts: includesDiscordToolArtifact ? [createDiscordCliArtifact(upstreamBaseUrl)] : [],
    runtimeClients: includesDiscordMcp
      ? [createDiscordMcpRuntimeClient(input.refs.artifactBinPath("discord"))]
      : [],
  };
}
