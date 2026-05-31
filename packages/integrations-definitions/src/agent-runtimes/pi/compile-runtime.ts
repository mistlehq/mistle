import type {
  CompileAgentRuntimeInput,
  CompileAgentRuntimeResult,
  EgressCredentialRoute,
  ResolvedIntegrationMcpServer,
  RuntimeClient,
  RuntimeClientSetupFile,
} from "@mistle/integrations-core";

import { renderMistleManagedSandboxContext } from "../shared/managed-instructions.js";
import {
  isAnthropicApiRoute,
  isOpenAiApiRoute,
  isOpenAiChatGptSubscriptionRoute,
} from "../shared/provider-egress-routes.js";
import { PiMcpAdapterExtensionBundle } from "./pi-mcp-adapter-extension.bundle.js";
import { PiPtyLaunchSpec } from "./pty-launch.js";
import type { PiRuntimeConfig } from "./runtime-config-schema.js";
import {
  PiProxyListenUrl,
  PiRuntimeClientId,
  PiRuntimeEndpointKey,
  PiRuntimeProcessKey,
} from "./server.js";

const PiCliArtifactKey = "pi-cli";
const PiCliVersion = "0.78.0";
const PiCliReleaseTag = `v${PiCliVersion}`;
const PiGitHubRepository = "earendil-works/pi";
const PiCliArchiveDirectory = "pi";
const PiCliInstallDirectoryName = "pi-cli";
const PiCliWrapperPath = "/usr/local/bin/pi";
const PiAgentDir = "/root/.pi/agent";
const PiSessionsDir = `${PiAgentDir}/sessions`;
const PiModelsPath = `${PiAgentDir}/models.json`;
const PiSettingsPath = `${PiAgentDir}/settings.json`;
const PiMcpConfigPath = `${PiAgentDir}/mcp.json`;
const PiMcpAdapterExtensionPath = `${PiAgentDir}/extensions/pi-mcp-adapter/index.js`;
const PiManagedInstructionsPath = `${PiAgentDir}/prompts/mistle-managed.md`;
const PiCliGitHubAssets = {
  x86_64: {
    fileName: "pi-linux-x64.tar.gz",
    sha256: "8ac03343d1e1228106e8172157f32d6b882829e46b34feaf577f171a5f1387cc",
  },
  aarch64: {
    fileName: "pi-linux-arm64.tar.gz",
    sha256: "49155173682473720d9decf4deecbed754fae84925ef003c0b66aac31d5f9005",
  },
};
const ArtifactCommandTimeoutMs = 120_000;
const MistleManagedApiKey = "mistle-managed-credential";
const ChatGptAuthJwtClaimPath = "https://api.openai.com/auth";

type PiSettings = {
  sessionDir: string;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  extensions?: readonly string[];
};

type PiModelsJson = Record<
  "providers",
  Record<
    string,
    {
      apiKey: string;
      headers: Record<string, never>;
    }
  >
>;

type PiProviderConfig = {
  provider: string;
  apiKey: string;
};

type PiMcpConfigServer = {
  command?: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  url?: string;
  headers?: Readonly<Record<string, string>>;
  directTools: false;
  lifecycle: "lazy";
};

type PiMcpConfig = {
  settings: {
    disableProxyTool: false;
  };
  mcpServers: Record<string, PiMcpConfigServer>;
};

function renderJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function renderManagedChatGptAccessToken(accountId: string): string {
  const header = base64UrlEncodeJson({
    alg: "none",
    typ: "JWT",
  });
  const payload = base64UrlEncodeJson({
    [ChatGptAuthJwtClaimPath]: {
      chatgpt_account_id: accountId,
    },
  });

  return `${header}.${payload}.`;
}

function base64UrlEncodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function readChatGptAccountId(route: EgressCredentialRoute): string {
  for (const [header, value] of Object.entries(route.additionalHeaders ?? {})) {
    if (header.toLowerCase() === "chatgpt-account-id" && value.trim().length > 0) {
      return value;
    }
  }

  throw new Error("Pi ChatGPT subscription routes require a ChatGPT-Account-ID additional header.");
}

function insertPiProviderConfig(input: {
  configsByProvider: Map<string, PiProviderConfig>;
  provider: string;
  apiKey: string;
}): void {
  const existing = input.configsByProvider.get(input.provider);
  if (existing !== undefined) {
    throw new Error(
      `Pi provider '${input.provider}' cannot be represented unambiguously because 2 supported egress routes matched the same built-in provider id.`,
    );
  }

  input.configsByProvider.set(input.provider, {
    provider: input.provider,
    apiKey: input.apiKey,
  });
}

function resolvePiProviderConfigs(
  egressRoutes: ReadonlyArray<EgressCredentialRoute>,
): readonly PiProviderConfig[] {
  const configsByProvider = new Map<string, PiProviderConfig>();

  for (const route of egressRoutes) {
    if (isOpenAiApiRoute(route)) {
      insertPiProviderConfig({
        configsByProvider,
        provider: "openai",
        apiKey: MistleManagedApiKey,
      });
    }

    if (isOpenAiChatGptSubscriptionRoute(route)) {
      insertPiProviderConfig({
        configsByProvider,
        provider: "openai-codex",
        apiKey: renderManagedChatGptAccessToken(readChatGptAccountId(route)),
      });
    }

    if (isAnthropicApiRoute(route)) {
      insertPiProviderConfig({
        configsByProvider,
        provider: "anthropic",
        apiKey: MistleManagedApiKey,
      });
    }
  }

  return [...configsByProvider.values()].sort((left, right) =>
    left.provider.localeCompare(right.provider),
  );
}

function renderPiModelsJson(egressRoutes: ReadonlyArray<EgressCredentialRoute>): string {
  const providers: PiModelsJson["providers"] = {};
  for (const { provider, apiKey } of resolvePiProviderConfigs(egressRoutes)) {
    providers[provider] = {
      apiKey,
      headers: {},
    };
  }

  const modelsJson: PiModelsJson = {
    providers,
  };

  return renderJson(modelsJson);
}

function renderPiSettings(input: { includeMcpAdapter: boolean }): string {
  const settings: PiSettings = {
    sessionDir: PiSessionsDir,
    steeringMode: "all",
    followUpMode: "all",
    ...(input.includeMcpAdapter ? { extensions: [PiMcpAdapterExtensionPath] } : {}),
  };

  return renderJson(settings);
}

function renderPiMcpConfig(mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>): string {
  const renderedServers: Record<string, PiMcpConfigServer> = {};

  for (const resolvedServer of mcpServers) {
    const { server } = resolvedServer;
    if (server.transport === "stdio") {
      if (server.command === undefined) {
        throw new Error(`Pi MCP server '${server.serverName}' is missing a stdio command.`);
      }
      renderedServers[server.serverName] = {
        command: server.command,
        ...(server.args === undefined ? {} : { args: server.args }),
        ...(server.env === undefined ? {} : { env: server.env }),
        directTools: false,
        lifecycle: "lazy",
      };
      continue;
    }

    if (server.url === undefined) {
      throw new Error(`Pi MCP server '${server.serverName}' is missing a remote URL.`);
    }
    renderedServers[server.serverName] = {
      url: server.url,
      ...(server.httpHeaders === undefined ? {} : { headers: server.httpHeaders }),
      directTools: false,
      lifecycle: "lazy",
    };
  }

  const config: PiMcpConfig = {
    settings: {
      disableProxyTool: false,
    },
    mcpServers: renderedServers,
  };

  return renderJson(config);
}

function renderPiCliWrapperScript(piCliInstallPath: string): string {
  return ["#!/bin/sh", "set -eu", `exec ${piCliInstallPath} "$@"`, ""].join("\n");
}

function buildPiSetupFiles(input: {
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
  piCliInstallPath: string;
}): ReadonlyArray<RuntimeClientSetupFile> {
  const includeMcpAdapter = input.mcpServers.length > 0;
  const files: RuntimeClientSetupFile[] = [
    {
      fileId: "pi_cli_wrapper",
      path: PiCliWrapperPath,
      mode: 493,
      writeMode: "overwrite",
      content: renderPiCliWrapperScript(input.piCliInstallPath),
    },
    {
      fileId: "pi_models",
      path: PiModelsPath,
      mode: 384,
      writeMode: "overwrite",
      content: renderPiModelsJson(input.egressRoutes),
    },
    {
      fileId: "pi_settings",
      path: PiSettingsPath,
      mode: 384,
      writeMode: "overwrite",
      content: renderPiSettings({
        includeMcpAdapter,
      }),
    },
    {
      fileId: "pi_managed_instructions",
      path: PiManagedInstructionsPath,
      mode: 384,
      writeMode: "overwrite",
      content: `${renderMistleManagedSandboxContext({ mcpServers: input.mcpServers })}\n`,
    },
  ];

  if (includeMcpAdapter) {
    files.push({
      fileId: "pi_mcp_adapter_extension",
      path: PiMcpAdapterExtensionPath,
      mode: 384,
      writeMode: "overwrite",
      content: PiMcpAdapterExtensionBundle,
    });
    files.push({
      fileId: "pi_mcp_config",
      path: PiMcpConfigPath,
      mode: 384,
      writeMode: "overwrite",
      content: renderPiMcpConfig(input.mcpServers),
    });
  }

  return files;
}

function buildPiRuntimeClients(input: {
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
  piCliInstallPath: string;
}): ReadonlyArray<RuntimeClient> {
  return [
    {
      clientId: PiRuntimeClientId,
      setup: {
        env: {
          MISTLE_PI_CLI_PATH: input.piCliInstallPath,
          PI_CODING_AGENT_DIR: PiAgentDir,
          PI_CODING_AGENT_SESSION_DIR: PiSessionsDir,
        },
        files: buildPiSetupFiles({
          egressRoutes: input.egressRoutes,
          mcpServers: input.mcpServers,
          piCliInstallPath: input.piCliInstallPath,
        }),
      },
      processes: [],
      endpoints: [
        {
          endpointKey: PiRuntimeEndpointKey,
          transport: {
            type: "ws",
            url: PiProxyListenUrl,
          },
          connectionMode: "dedicated",
        },
      ],
    },
  ];
}

export function compilePiRuntime(
  input: CompileAgentRuntimeInput<PiRuntimeConfig>,
): CompileAgentRuntimeResult {
  const piCliInstallDirectory = `${input.refs.sandboxPaths.runtimeArtifactDir}/${PiCliInstallDirectoryName}`;
  const piCliInstallPath = `${piCliInstallDirectory}/pi`;
  const mcpServers = input.runtimeConfig.enableMcp ? input.mcpServers : [];

  return {
    artifacts: [
      {
        artifactKey: PiCliArtifactKey,
        name: "Pi CLI",
        lifecycle: {
          install: ({ refs }) => [
            refs.githubReleases.install({
              repository: PiGitHubRepository,
              release: {
                kind: "tag",
                match: "exact",
                tag: PiCliReleaseTag,
              },
              asset: {
                kind: "by_arch",
                x86_64: {
                  fileName: PiCliGitHubAssets.x86_64.fileName,
                  format: "tar.gz",
                  extractedPath: PiCliArchiveDirectory,
                  sha256: PiCliGitHubAssets.x86_64.sha256,
                },
                aarch64: {
                  fileName: PiCliGitHubAssets.aarch64.fileName,
                  format: "tar.gz",
                  extractedPath: PiCliArchiveDirectory,
                  sha256: PiCliGitHubAssets.aarch64.sha256,
                },
              },
              installPath: `${refs.sandboxPaths.runtimeArtifactDir}/${PiCliInstallDirectoryName}`,
              timeoutMs: ArtifactCommandTimeoutMs,
            }),
          ],
        },
      },
    ],
    renderRuntimeClients: ({ egressRoutes }) =>
      buildPiRuntimeClients({
        egressRoutes,
        mcpServers,
        piCliInstallPath,
      }),
    agentRuntimes: [
      {
        runtimeId: "pi",
        runtimeKey: PiRuntimeProcessKey,
        clientId: PiRuntimeClientId,
        endpointKey: PiRuntimeEndpointKey,
        ptyLaunch: PiPtyLaunchSpec,
      },
    ],
  };
}
