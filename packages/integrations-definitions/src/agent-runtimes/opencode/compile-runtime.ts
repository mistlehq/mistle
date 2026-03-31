import {
  type AgentProviderAccess,
  type CompileAgentRuntimeInput,
  type CompileAgentRuntimeResult,
  type RuntimeArtifactCommand,
} from "@mistle/integrations-core";

import { renderOpencodeBridgeScript } from "./bridge-script.js";
import { OpencodePtyLaunchSpec } from "./pty-launch.js";
import {
  OpencodeBridgeEndpointKey,
  OpencodeBridgeListenUrl,
  OpencodeBridgeProcessKey,
  OpencodeBridgeScriptPath,
  OpencodeServerProcessKey,
  OpencodeServerStatusUrl,
} from "./server.js";

const OpencodeCliArtifactKey = "opencode-cli";
const OpencodeConfigDirectoryPath = "/etc/opencode";
const OpencodeConfigFilePath = `${OpencodeConfigDirectoryPath}/opencode.json`;
const OpencodeAgentsFilePath = `${OpencodeConfigDirectoryPath}/AGENTS.md`;
const OpencodeBinaryInstallPathName = "opencode";
const OpencodeGitHubRepository = "anomalyco/opencode";
const OpencodeProxyApiKey = "mistle-proxy";
const ArtifactCommandTimeoutMs = 120_000;
const RuntimeClientProcessReadinessTimeoutMs = 5_000;
const RuntimeClientProcessStopTimeoutMs = 10_000;
const RuntimeClientProcessStopGracePeriodMs = 2_000;
const ManagedSandboxContext = [
  "Mistle-managed sandbox context:",
  "",
  "- This runtime operates behind a managed outbound proxy.",
  "- Network tools and scripts should use the sandbox's existing proxy configuration rather than expecting direct outbound access.",
  "- Provider credentials may be injected by the platform outside the sandboxed process environment.",
  "- Do not assume missing API keys or auth-related environment variables inside the sandbox mean authentication is misconfigured.",
  "- Prefer debugging request behavior and proxy-mediated access before treating missing in-process credentials as the root cause.",
  "- Do not modify proxy-related environment variables unless explicitly instructed.",
].join("\n");
const OpencodeClientId = "opencode-cli";

type OpencodeProviderMetadata = {
  reasoningEffort: string;
  additionalInstructions?: string;
};

function resolveOpencodeProviderMetadata(
  providerAccess: AgentProviderAccess,
): OpencodeProviderMetadata | null {
  const providerMetadata = providerAccess.providerMetadata;
  if (providerMetadata === undefined) {
    return null;
  }

  const reasoningEffort = providerMetadata["reasoningEffort"];
  if (typeof reasoningEffort !== "string" || reasoningEffort.trim().length === 0) {
    return null;
  }

  const additionalInstructions = providerMetadata["additionalInstructions"];
  if (additionalInstructions === undefined) {
    return {
      reasoningEffort,
    };
  }

  if (typeof additionalInstructions !== "string") {
    return null;
  }

  return {
    reasoningEffort,
    additionalInstructions,
  };
}

function renderInstallOpencodeCliScript(input: { installPath: string }): string {
  return [
    'arch="$(uname -m)"',
    'case "$arch" in',
    "  x86_64)",
    '    asset_name="opencode-linux-x64-baseline.tar.gz"',
    "    ;;",
    "  aarch64|arm64)",
    '    asset_name="opencode-linux-arm64.tar.gz"',
    "    ;;",
    "  *)",
    '    echo "Unsupported architecture: $arch" >&2',
    "    exit 1",
    "    ;;",
    "esac",
    "",
    `tag_name="$(curl --noproxy '*' -fsSI https://github.com/${OpencodeGitHubRepository}/releases/latest | tr -d '\\r' | sed -n 's/^[Ll]ocation: .*\\/tag\\/\\([^[:space:]]*\\)$/\\1/p' | tail -n1)"`,
    'if [ -z "$tag_name" ]; then',
    '  echo "Failed to resolve latest OpenCode release tag." >&2',
    "  exit 1",
    "fi",
    `download_url="https://github.com/${OpencodeGitHubRepository}/releases/download/\${tag_name}/\${asset_name}"`,
    `install_path=${JSON.stringify(input.installPath)}`,
    'temp_dir="$(mktemp -d)"',
    "trap 'rm -rf \"$temp_dir\"' EXIT",
    'curl --noproxy "*" -fsSL "$download_url" -o "$temp_dir/opencode.tar.gz"',
    'tar -xzf "$temp_dir/opencode.tar.gz" -C "$temp_dir"',
    'install -m 0755 "$temp_dir/opencode" "$install_path"',
  ].join("\n");
}

function buildOpencodeCliInstallCommand(input: { installPath: string }): RuntimeArtifactCommand {
  return {
    args: ["sh", "-euc", renderInstallOpencodeCliScript(input)],
    timeoutMs: ArtifactCommandTimeoutMs,
  };
}

function composeDeveloperInstructions(additionalInstructions?: string): string {
  if (additionalInstructions === undefined) {
    return ManagedSandboxContext;
  }

  return [
    ManagedSandboxContext,
    "",
    "User-provided additional instructions:",
    "",
    additionalInstructions,
  ].join("\n");
}

function renderOpencodeConfig(input: {
  model: string;
  apiBaseUrl: string;
  allowedModels: readonly string[];
  reasoningEffort: string;
}): string {
  return `${JSON.stringify(
    {
      autoupdate: false,
      share: "disabled",
      enabled_providers: ["openai"],
      model: `openai/${input.model}`,
      agent: {
        build: {
          model: `openai/${input.model}`,
          variant: input.reasoningEffort,
        },
        plan: {
          model: `openai/${input.model}`,
          variant: input.reasoningEffort,
        },
      },
      provider: {
        openai: {
          whitelist: [...input.allowedModels],
          options: {
            baseURL: input.apiBaseUrl,
            apiKey: OpencodeProxyApiKey,
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

export function compileOpencodeRuntime(
  input: CompileAgentRuntimeInput<Record<string, never>>,
): CompileAgentRuntimeResult {
  const routeHost = new URL(input.providerAccess.apiBaseUrl).host;
  const opencodeCliInstallPath = input.refs.artifactBinPath(OpencodeBinaryInstallPathName);
  const providerMetadata = resolveOpencodeProviderMetadata(input.providerAccess);

  if (providerMetadata === null) {
    throw new Error("OpenCode runtime requires provider reasoning metadata.");
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
        credentialResolver: {
          connectionId: input.providerAccess.credentialResolver.connectionId,
          secretType: input.providerAccess.credentialResolver.secretType,
        },
      },
    ],
    artifacts: [
      {
        artifactKey: OpencodeCliArtifactKey,
        name: "OpenCode CLI",
        lifecycle: {
          install: () => [
            buildOpencodeCliInstallCommand({
              installPath: opencodeCliInstallPath,
            }),
          ],
        },
      },
    ],
    runtimeClients: [
      {
        clientId: OpencodeClientId,
        setup: {
          env: {
            OPENCODE_CONFIG_DIR: OpencodeConfigDirectoryPath,
            OPENCODE_CONFIG: OpencodeConfigFilePath,
          },
          files: [
            {
              fileId: "opencode_config",
              path: OpencodeConfigFilePath,
              mode: 384,
              content: renderOpencodeConfig({
                model: input.providerAccess.defaultModel,
                apiBaseUrl: input.providerAccess.apiBaseUrl,
                allowedModels: input.providerAccess.allowedModels,
                reasoningEffort: providerMetadata.reasoningEffort,
              }),
            },
            {
              fileId: "opencode_agents",
              path: OpencodeAgentsFilePath,
              mode: 420,
              content: `${composeDeveloperInstructions(providerMetadata.additionalInstructions)}\n`,
            },
            {
              fileId: "opencode_bridge_script",
              path: OpencodeBridgeScriptPath,
              mode: 493,
              content: renderOpencodeBridgeScript(),
            },
          ],
        },
        processes: [
          {
            processKey: OpencodeServerProcessKey,
            command: {
              args: [opencodeCliInstallPath, "serve", "--hostname", "127.0.0.1", "--port", "4601"],
              cwd: input.refs.sandboxPaths.workspaceDir,
            },
            readiness: {
              type: "http",
              url: OpencodeServerStatusUrl,
              expectedStatus: 200,
              timeoutMs: RuntimeClientProcessReadinessTimeoutMs,
            },
            stop: {
              signal: "sigterm",
              timeoutMs: RuntimeClientProcessStopTimeoutMs,
              gracePeriodMs: RuntimeClientProcessStopGracePeriodMs,
            },
          },
          {
            processKey: OpencodeBridgeProcessKey,
            command: {
              args: ["node", OpencodeBridgeScriptPath],
            },
            readiness: {
              type: "ws",
              url: OpencodeBridgeListenUrl,
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
            endpointKey: OpencodeBridgeEndpointKey,
            processKey: OpencodeBridgeProcessKey,
            transport: {
              type: "ws",
              url: OpencodeBridgeListenUrl,
            },
            connectionMode: "dedicated",
          },
        ],
      },
    ],
    agentRuntimes: [
      {
        runtimeId: "opencode",
        runtimeKey: OpencodeBridgeProcessKey,
        clientId: OpencodeClientId,
        endpointKey: OpencodeBridgeEndpointKey,
        ptyLaunch: OpencodePtyLaunchSpec,
      },
    ],
  };
}
