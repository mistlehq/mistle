import type {
  AgentProviderAccess,
  CompileAgentRuntimeInput,
  CompileAgentRuntimeResult,
} from "@mistle/integrations-core";

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
const OpenCodeCliVersion = "1.14.48";
const OpenCodeCliReleaseTag = `v${OpenCodeCliVersion}`;
const OpenCodeGitHubRepository = "anomalyco/opencode";
const OpenCodeConfigPath = "/root/.config/opencode/opencode.json";
const OpenCodeGlobalAgentsPath = "/root/.config/opencode/AGENTS.md";
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

type OpenCodeProviderMetadata = {
  responsesApiBaseUrl: string;
};

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

type OpenCodeProviderConfig = {
  options: {
    apiKey: string;
    baseURL: string;
  };
};

type OpenCodeConfig = {
  server: {
    hostname: string;
    port: number;
    mdns: boolean;
  };
  provider: Record<string, OpenCodeProviderConfig>;
};

function renderOpenCodeConfig(input: { providerBaseUrl: string }): string {
  const config: OpenCodeConfig = {
    server: {
      hostname: OpenCodeServerListenHost,
      port: OpenCodeServerListenPort,
      mdns: false,
    },
    provider: {
      openai: {
        options: {
          apiKey: "mistle-managed-credential",
          baseURL: input.providerBaseUrl,
        },
      },
    },
  };

  return `${JSON.stringify(config, null, 2)}\n`;
}

function renderOpenCodeGlobalAgentsMd(): string {
  return `${OpenCodeGlobalAgentsMd}\n`;
}

function resolveOpenCodeProviderMetadata(
  providerAccess: AgentProviderAccess,
): OpenCodeProviderMetadata | null {
  const providerMetadata = providerAccess.providerMetadata;
  if (providerMetadata === undefined) {
    return null;
  }

  const responsesApiBaseUrl = providerMetadata["responsesApiBaseUrl"];
  if (typeof responsesApiBaseUrl !== "string" || responsesApiBaseUrl.trim().length === 0) {
    return null;
  }

  return {
    responsesApiBaseUrl,
  };
}

export function compileOpenCodeRuntime(
  input: CompileAgentRuntimeInput<Record<string, never>>,
): CompileAgentRuntimeResult {
  const routeHost = new URL(input.providerAccess.apiBaseUrl).host;
  const openCodeCliInstallPath = input.refs.artifactBinPath("opencode");
  const providerMetadata = resolveOpenCodeProviderMetadata(input.providerAccess);

  if (providerMetadata === null) {
    throw new Error("OpenCode runtime requires provider URL metadata.");
  }

  return {
    egressRoutes: [
      {
        match: {
          hosts: [routeHost],
          pathPrefixes: [...input.providerAccess.allowedPathPrefixes],
          methods: [...input.providerAccess.allowedMethods],
        },
        upstream: {
          baseUrl: input.providerAccess.apiBaseUrl,
        },
        authInjection: {
          type: input.providerAccess.authScheme,
          target: "authorization",
        },
        ...(input.providerAccess.additionalHeaders === undefined
          ? {}
          : { additionalHeaders: input.providerAccess.additionalHeaders }),
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.providerAccess.credentialResolver.connectionId,
          secretType: input.providerAccess.credentialResolver.secretType,
          ...(input.providerAccess.credentialResolver.slotKey === undefined
            ? {}
            : { slotKey: input.providerAccess.credentialResolver.slotKey }),
        },
      },
    ],
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
    runtimeClients: [
      {
        clientId: "opencode-cli",
        setup: {
          env: {},
          files: [
            {
              fileId: "opencode_config",
              path: OpenCodeConfigPath,
              mode: 384,
              writeMode: "if-absent",
              content: renderOpenCodeConfig({
                providerBaseUrl: providerMetadata.responsesApiBaseUrl,
              }),
            },
            {
              fileId: "opencode_global_agents",
              path: OpenCodeGlobalAgentsPath,
              mode: 384,
              writeMode: "if-absent",
              content: renderOpenCodeGlobalAgentsMd(),
            },
          ],
        },
        processes: [
          {
            processKey: OpenCodeServerProcessKey,
            command: {
              args: [
                openCodeCliInstallPath,
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
    ],
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
