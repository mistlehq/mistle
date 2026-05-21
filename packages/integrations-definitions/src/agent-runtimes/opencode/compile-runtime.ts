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
  isOpenCodeGoRoute,
} from "../shared/provider-egress-routes.js";
import { OpenCodePtyLaunchSpec } from "./pty-launch.js";
import {
  OpenCodeProxyListenUrl,
  OpenCodeServerEndpointKey,
  OpenCodeServerHealthUrl,
  OpenCodeServerListenHost,
  OpenCodeServerListenPort,
  OpenCodeServerProcessKey,
} from "./server.js";

const OpenCodeCliArtifactKey = "opencode-cli";
const OpenCodeCliVersion = "1.15.1";
const OpenCodeCliReleaseTag = `v${OpenCodeCliVersion}`;
const OpenCodeGitHubRepository = "anomalyco/opencode";
const OpenCodeConfigPath = "/root/.config/opencode/opencode.json";
const OpenCodeGlobalAgentsPath = "/root/.config/opencode/AGENTS.md";
const OpenCodeAuthPath = "/root/.local/share/opencode/auth.json";
const OpenCodeGitHubAssets = {
  x86_64: {
    fileName: "opencode-linux-x64-baseline.tar.gz",
    binaryPath: "opencode",
    sha256: "5f457b515896df8c9b48707e8475cbd98375f76b4e81a0b97f54b9d98228bd63",
  },
  aarch64: {
    fileName: "opencode-linux-arm64.tar.gz",
    binaryPath: "opencode",
    sha256: "58bdd72718817043f9e3328c9f78acc6c667dd26e5fd013a6cf3c03593de2374",
  },
};
const ArtifactCommandTimeoutMs = 120_000;
const RuntimeClientProcessReadinessTimeoutMs = 60_000;
const RuntimeClientProcessStopTimeoutMs = 10_000;
const RuntimeClientProcessStopGracePeriodMs = 2_000;
const MistleManagedApiKey = "mistle-managed-credential";
const MistleManagedChatGptAccess = "mistle-managed-access";
const MistleManagedChatGptRefresh = "mistle-managed-refresh";
const MistleManagedChatGptExpires = 4_102_444_800_000;

type OpenCodeConfig = {
  server: {
    hostname: string;
    port: number;
    mdns: boolean;
  };
};

type OpenCodeManagedConfig = {
  enabled_providers: readonly string[];
};

type OpenCodeApiAuth = {
  type: "api";
  key: string;
};

type OpenCodeOauthAuth = {
  type: "oauth";
  refresh: string;
  access: string;
  expires: number;
  accountId?: string;
};

type OpenCodeAuth = OpenCodeApiAuth | OpenCodeOauthAuth;

type OpenCodeAuthContent = Record<string, OpenCodeAuth>;

function resolveOpenCodeEnabledProviders(
  egressRoutes: ReadonlyArray<EgressCredentialRoute>,
): readonly string[] {
  const providers = new Set<string>();

  for (const route of egressRoutes) {
    if (isOpenAiApiRoute(route) || isOpenAiChatGptSubscriptionRoute(route)) {
      providers.add("openai");
    }

    if (isAnthropicApiRoute(route)) {
      providers.add("anthropic");
    }

    if (isOpenCodeGoRoute(route)) {
      providers.add("opencode-go");
    }
  }

  return [...providers].sort((left, right) => left.localeCompare(right));
}

function renderOpenCodeConfig(): string {
  const config: OpenCodeConfig = {
    server: {
      hostname: OpenCodeServerListenHost,
      port: OpenCodeServerListenPort,
      mdns: false,
    },
  };

  return `${JSON.stringify(config, null, 2)}\n`;
}

function renderOpenCodeManagedConfigContent(enabledProviders: readonly string[]): string {
  const config: OpenCodeManagedConfig = {
    enabled_providers: enabledProviders,
  };

  return JSON.stringify(config);
}

function renderOpenCodeGlobalAgentsMd(input: {
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): string {
  return `${renderMistleManagedSandboxContext({ mcpServers: input.mcpServers })}\n`;
}

function readChatGptAccountId(route: EgressCredentialRoute): string | undefined {
  for (const [header, value] of Object.entries(route.additionalHeaders ?? {})) {
    if (header.toLowerCase() === "chatgpt-account-id" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function insertOpenCodeAuth(input: {
  auth: OpenCodeAuthContent;
  providerId: string;
  value: OpenCodeAuth;
}): void {
  const existing = input.auth[input.providerId];
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(input.value)) {
    throw new Error(
      `OpenCode runtime cannot represent multiple auth shapes for provider '${input.providerId}'.`,
    );
  }

  input.auth[input.providerId] = input.value;
}

function renderOpenCodeAuthContent(
  egressRoutes: ReadonlyArray<EgressCredentialRoute>,
): string | undefined {
  const auth: OpenCodeAuthContent = {};

  for (const route of egressRoutes) {
    if (isOpenAiApiRoute(route)) {
      insertOpenCodeAuth({
        auth,
        providerId: "openai",
        value: {
          type: "api",
          key: MistleManagedApiKey,
        },
      });
    }

    if (isOpenAiChatGptSubscriptionRoute(route)) {
      const accountId = readChatGptAccountId(route);
      insertOpenCodeAuth({
        auth,
        providerId: "openai",
        value: {
          type: "oauth",
          refresh: MistleManagedChatGptRefresh,
          access: MistleManagedChatGptAccess,
          expires: MistleManagedChatGptExpires,
          ...(accountId === undefined ? {} : { accountId }),
        },
      });
    }

    if (isAnthropicApiRoute(route)) {
      insertOpenCodeAuth({
        auth,
        providerId: "anthropic",
        value: {
          type: "api",
          key: MistleManagedApiKey,
        },
      });
    }

    if (isOpenCodeGoRoute(route)) {
      insertOpenCodeAuth({
        auth,
        providerId: "opencode-go",
        value: {
          type: "api",
          key: MistleManagedApiKey,
        },
      });
    }
  }

  return Object.keys(auth).length === 0 ? undefined : `${JSON.stringify(auth, null, 2)}\n`;
}

function buildOpenCodeSetupFiles(
  authContent: string | undefined,
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>,
): ReadonlyArray<RuntimeClientSetupFile> {
  const files: RuntimeClientSetupFile[] = [
    {
      fileId: "opencode_config",
      path: OpenCodeConfigPath,
      mode: 384,
      writeMode: "if-absent",
      content: renderOpenCodeConfig(),
    },
    {
      fileId: "opencode_global_agents",
      path: OpenCodeGlobalAgentsPath,
      mode: 384,
      writeMode: "if-absent",
      content: renderOpenCodeGlobalAgentsMd({ mcpServers }),
    },
  ];

  if (authContent !== undefined) {
    files.push({
      fileId: "opencode_auth",
      path: OpenCodeAuthPath,
      mode: 384,
      writeMode: "overwrite",
      content: authContent,
    });
  }

  return files;
}

function buildOpenCodeRuntimeClients(input: {
  openCodeCliInstallPath: string;
  authContent?: string;
  enabledProviders?: readonly string[];
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): ReadonlyArray<RuntimeClient> {
  return [
    {
      clientId: "opencode-cli",
      setup: {
        env:
          input.enabledProviders === undefined
            ? {}
            : {
                OPENCODE_CONFIG_CONTENT: renderOpenCodeManagedConfigContent(input.enabledProviders),
              },
        files: buildOpenCodeSetupFiles(input.authContent, input.mcpServers),
      },
      processes: [
        {
          processKey: OpenCodeServerProcessKey,
          command: {
            args: [
              input.openCodeCliInstallPath,
              "serve",
              "--hostname",
              OpenCodeServerListenHost,
              "--port",
              String(OpenCodeServerListenPort),
            ],
          },
          readiness: {
            type: "http",
            url: OpenCodeServerHealthUrl,
            expectedStatus: 200,
            timeoutMs: RuntimeClientProcessReadinessTimeoutMs,
          },
          stop: {
            signal: "sigterm",
            timeoutMs: RuntimeClientProcessStopTimeoutMs,
            gracePeriodMs: RuntimeClientProcessStopGracePeriodMs,
          },
        },
      ],
      endpoints: [
        {
          endpointKey: OpenCodeServerEndpointKey,
          processKey: OpenCodeServerProcessKey,
          transport: {
            type: "ws",
            url: OpenCodeProxyListenUrl,
          },
          connectionMode: "dedicated",
        },
      ],
    },
  ];
}

export function compileOpenCodeRuntime(
  input: CompileAgentRuntimeInput<Record<string, never>>,
): CompileAgentRuntimeResult {
  const openCodeCliInstallPath = input.refs.artifactBinPath("opencode");

  return {
    artifacts: [
      {
        artifactKey: OpenCodeCliArtifactKey,
        name: "OpenCode CLI",
        lifecycle: {
          install: ({ refs }) => [
            refs.githubReleases.install({
              repository: OpenCodeGitHubRepository,
              release: {
                kind: "tag",
                match: "exact",
                tag: OpenCodeCliReleaseTag,
              },
              asset: {
                kind: "by_arch",
                x86_64: {
                  fileName: OpenCodeGitHubAssets.x86_64.fileName,
                  format: "tar.gz",
                  extractedPath: OpenCodeGitHubAssets.x86_64.binaryPath,
                  sha256: OpenCodeGitHubAssets.x86_64.sha256,
                },
                aarch64: {
                  fileName: OpenCodeGitHubAssets.aarch64.fileName,
                  format: "tar.gz",
                  extractedPath: OpenCodeGitHubAssets.aarch64.binaryPath,
                  sha256: OpenCodeGitHubAssets.aarch64.sha256,
                },
              },
              installPath: refs.artifactBinPath("opencode"),
              timeoutMs: ArtifactCommandTimeoutMs,
            }),
          ],
        },
      },
    ],
    runtimeClients: buildOpenCodeRuntimeClients({
      openCodeCliInstallPath,
      mcpServers: input.mcpServers,
    }),
    renderRuntimeClients: ({ egressRoutes }) => {
      const authContent = renderOpenCodeAuthContent(egressRoutes);
      const enabledProviders = resolveOpenCodeEnabledProviders(egressRoutes);

      return buildOpenCodeRuntimeClients({
        openCodeCliInstallPath,
        ...(authContent === undefined ? {} : { authContent }),
        enabledProviders,
        mcpServers: input.mcpServers,
      });
    },
    agentRuntimes: [
      {
        runtimeId: "opencode",
        runtimeKey: OpenCodeServerProcessKey,
        clientId: "opencode-cli",
        endpointKey: OpenCodeServerEndpointKey,
        ptyLaunch: OpenCodePtyLaunchSpec,
      },
    ],
  };
}
