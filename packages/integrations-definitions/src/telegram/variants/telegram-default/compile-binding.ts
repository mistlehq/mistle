import {
  resolveRoutePathPrefixFromBaseUrl,
  type CompileBindingInput,
  type CompileBindingResult,
  type RuntimeClient,
} from "@mistle/integrations-core";

import { TelegramCredentialSecretTypes, TelegramCredentialSlotKeys } from "./auth.js";
import type { TelegramBindingConfig } from "./binding-config-schema.js";
import type { TelegramTargetConfig } from "./target-config-schema.js";
import { TelegramToolIds } from "./tool-ids.js";

export type TelegramCompileBindingInput = CompileBindingInput<
  TelegramTargetConfig,
  TelegramBindingConfig
>;

const TelegramCliArtifactKey = "telegram-cli";
const TelegramCliArtifactName = "Telegram CLI";
const ArtifactCommandTimeoutMs = 120_000;
export const TelegramMcpHost = "127.0.0.1";
export const TelegramMcpPort = 7357;
export const TelegramMcpEndpoint = "/mcp";
export const TelegramMcpUrl = `http://${TelegramMcpHost}:${String(TelegramMcpPort)}${TelegramMcpEndpoint}`;
const TelegramMcpClientId = "telegram-mcp";
const TelegramMcpProcessKey = "telegram-mcp-server";
const TelegramMcpReadinessTimeoutMs = 60_000;
const TelegramMcpProcessStopTimeoutMs = 10_000;
const TelegramMcpProcessStopGracePeriodMs = 2_000;
const TelegramCliReleaseTag = "telegram/v0.1.0";
const TelegramCliLinuxAmd64Sha256 =
  "8f5b6c62f7451ad02cf19d8fc4316f426b0816e9767dd22350e792c043680ea5";

function createTelegramCliArtifact(
  upstreamBaseUrl: string,
): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: TelegramCliArtifactKey,
    name: TelegramCliArtifactName,
    env: {
      TELEGRAM_BASE_URL: upstreamBaseUrl,
    },
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: TelegramCliReleaseTag,
          },
          asset: {
            kind: "exact",
            fileName: "telegram-linux-amd64",
            format: "binary",
            sha256: TelegramCliLinuxAmd64Sha256,
          },
          installPath: refs.artifactBinPath("telegram"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

function createTelegramMcpRuntimeClient(telegramCliInstallPath: string): RuntimeClient {
  return {
    clientId: TelegramMcpClientId,
    setup: {
      env: {},
      files: [],
    },
    processes: [
      {
        processKey: TelegramMcpProcessKey,
        command: {
          args: [
            telegramCliInstallPath,
            "mcp",
            "serve",
            "--addr",
            `${TelegramMcpHost}:${String(TelegramMcpPort)}`,
            "--endpoint",
            TelegramMcpEndpoint,
          ],
        },
        readiness: {
          type: "tcp",
          host: TelegramMcpHost,
          port: TelegramMcpPort,
          timeoutMs: TelegramMcpReadinessTimeoutMs,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: TelegramMcpProcessStopTimeoutMs,
          gracePeriodMs: TelegramMcpProcessStopGracePeriodMs,
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

export function compileTelegramBinding(input: TelegramCompileBindingInput): CompileBindingResult {
  const includesTelegramCli = input.binding.config.tools.includes(TelegramToolIds.TELEGRAM_CLI);
  const includesTelegramMcp = input.binding.config.tools.includes(TelegramToolIds.TELEGRAM_MCP);
  const includesTelegramToolArtifact = includesTelegramCli || includesTelegramMcp;
  const upstreamBaseUrl = input.target.config.apiBaseUrl;

  return {
    egressRoutes: [
      {
        match: resolveMatchFromBaseUrl(upstreamBaseUrl),
        upstream: {
          baseUrl: upstreamBaseUrl,
        },
        authInjection: {
          type: "path_segment_prefix",
          segmentPrefix: "bot",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: TelegramCredentialSecretTypes.API_KEY,
          slotKey: TelegramCredentialSlotKeys.BOT_TOKEN,
        },
      },
    ],
    artifacts: includesTelegramToolArtifact ? [createTelegramCliArtifact(upstreamBaseUrl)] : [],
    runtimeClients: includesTelegramMcp
      ? [createTelegramMcpRuntimeClient(input.refs.artifactBinPath("telegram"))]
      : [],
  };
}
