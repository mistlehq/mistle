import type {
  CompileAgentRuntimeInput,
  CompileAgentRuntimeResult,
  EgressCredentialRoute,
  RuntimeClient,
  RuntimeClientSetupFile,
} from "@mistle/integrations-core";

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
const OpenCodeCliVersion = "1.14.50";
const OpenCodeCliReleaseTag = `v${OpenCodeCliVersion}`;
const OpenCodeGitHubRepository = "anomalyco/opencode";
const OpenCodeConfigPath = "/root/.config/opencode/opencode.json";
const OpenCodeGlobalAgentsPath = "/root/.config/opencode/AGENTS.md";
const OpenCodeAuthPath = "/root/.local/share/opencode/auth.json";
const OpenCodeGitHubAssets = {
  x86_64: {
    fileName: "opencode-linux-x64-baseline.tar.gz",
    binaryPath: "opencode",
  },
  aarch64: {
    fileName: "opencode-linux-arm64.tar.gz",
    binaryPath: "opencode",
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

const OpenCodeGlobalAgentsMd = [
  "Mistle-managed sandbox context:",
  "",
  "- This runtime operates behind a managed outbound proxy.",
  "- Network tools and scripts should use the sandbox's existing proxy configuration rather than expecting direct outbound access.",
  "- Provider credentials may be injected by the platform outside the sandboxed process environment.",
  "- Do not assume missing API keys or auth-related environment variables inside the sandbox mean authentication is misconfigured.",
  "- Prefer debugging request behavior and proxy-mediated access before treating missing in-process credentials as the root cause.",
  "- Do not modify proxy-related environment variables unless explicitly instructed.",
  "- When interacting with external systems, prefer the provider CLI available in the environment over ad hoc HTTP requests or raw `curl`.",
  "- Use `cmddir search <pattern>` to discover relevant commands progressively before reaching for lower-level approaches.",
  "- Examples:",
  "  - `cmddir search '^gh$'`",
  "  - `cmddir search '^(jira|slack)$'`",
].join("\n");

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

function renderOpenCodeGlobalAgentsMd(): string {
  return `${OpenCodeGlobalAgentsMd}\n`;
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
      content: renderOpenCodeGlobalAgentsMd(),
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
        files: buildOpenCodeSetupFiles(input.authContent),
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
                },
                aarch64: {
                  fileName: OpenCodeGitHubAssets.aarch64.fileName,
                  format: "tar.gz",
                  extractedPath: OpenCodeGitHubAssets.aarch64.binaryPath,
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
    }),
    renderRuntimeClients: ({ egressRoutes }) => {
      const authContent = renderOpenCodeAuthContent(egressRoutes);
      const enabledProviders = resolveOpenCodeEnabledProviders(egressRoutes);

      return buildOpenCodeRuntimeClients({
        openCodeCliInstallPath,
        ...(authContent === undefined ? {} : { authContent }),
        enabledProviders,
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
