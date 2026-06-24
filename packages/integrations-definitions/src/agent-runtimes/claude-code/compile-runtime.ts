import { ClaudeCodeRuntimeServerBundle } from "@mistle/claude-code-runtime-server";
import type {
  CompileAgentRuntimeInput,
  CompileAgentRuntimeResult,
  EgressCredentialRoute,
  ResolvedIntegrationMcpServer,
  RuntimeClient,
  RuntimeClientSetupFile,
} from "@mistle/integrations-core";

import { isAnthropicApiRoute } from "../shared/provider-egress-routes.js";
import { ClaudeCodePtyLaunchSpec } from "./pty-launch.js";
import {
  ClaudeCodeExecutablePath,
  ClaudeCodeRuntimeClientId,
  ClaudeCodeRuntimeId,
  ClaudeCodeRuntimeServerEndpointKey,
  ClaudeCodeRuntimeServerHealthPath,
  ClaudeCodeRuntimeServerHealthUrl,
  ClaudeCodeRuntimeServerHost,
  ClaudeCodeRuntimeServerPackageDir,
  ClaudeCodeRuntimeServerPath,
  ClaudeCodeRuntimeServerPort,
  ClaudeCodeRuntimeServerProcessKey,
  ClaudeCodeRuntimeServerWsPath,
  ClaudeCodeRuntimeServerWsUrl,
} from "./server.js";

const NodeArtifactKey = "claude-code-node";
const RuntimeServerArtifactKey = "claude-code-runtime-server-dependencies";
const RuntimeClientProcessReadinessTimeoutMs = 60_000;
const RuntimeClientProcessStopTimeoutMs = 10_000;
const RuntimeClientProcessStopGracePeriodMs = 2_000;
const ArtifactCommandTimeoutMs = 120_000;
const ClaudeCodeNodeTool = "node@25.0.0";
const ClaudeAgentSdkVersion = "0.3.191";
const MistleManagedApiKey = "mistle-managed-credential";
const ClaudeCodeMcpConfigPath = "/root/.claude/mcp.json";

type ClaudeCodeRuntimeEnvironment = {
  ANTHROPIC_API_KEY: string;
  MISTLE_CLAUDE_CODE_RUNTIME_HEALTH_PATH: string;
  MISTLE_CLAUDE_CODE_RUNTIME_HOST: string;
  MISTLE_CLAUDE_CODE_RUNTIME_PORT: string;
  MISTLE_CLAUDE_CODE_RUNTIME_WS_PATH: string;
};

type ClaudeCodeMcpConfigServer =
  | {
      args?: readonly string[];
      command: string;
      env?: Readonly<Record<string, string>>;
    }
  | {
      headers?: Readonly<Record<string, string>>;
      type: "http";
      url: string;
    };

type ClaudeCodeMcpConfig = {
  mcpServers: Record<string, ClaudeCodeMcpConfigServer>;
};

function renderJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function renderRuntimeServerPackageJson(): string {
  return renderJson({
    type: "module",
    dependencies: {
      "@anthropic-ai/claude-agent-sdk": ClaudeAgentSdkVersion,
      ws: "^8.21.0",
    },
  });
}

function renderClaudeCodeMcpConfig(
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>,
): string {
  const renderedServers: Record<string, ClaudeCodeMcpConfigServer> = {};
  for (const resolvedServer of mcpServers) {
    const { server } = resolvedServer;
    if (server.transport === "stdio") {
      if (server.command === undefined) {
        throw new Error(
          `Claude Code MCP server '${server.serverName}' is missing a stdio command.`,
        );
      }
      renderedServers[server.serverName] = {
        command: server.command,
        ...(server.args === undefined ? {} : { args: server.args }),
        ...(server.env === undefined ? {} : { env: server.env }),
      };
      continue;
    }

    const transport: string = server.transport;
    if (transport !== "streamable-http") {
      throw new Error(
        `Claude Code MCP server '${server.serverName}' uses unsupported transport '${transport}'.`,
      );
    }
    if (server.url === undefined) {
      throw new Error(`Claude Code MCP server '${server.serverName}' is missing a remote URL.`);
    }
    renderedServers[server.serverName] = {
      type: "http",
      url: server.url,
      ...(server.httpHeaders === undefined ? {} : { headers: server.httpHeaders }),
    };
  }

  const config: ClaudeCodeMcpConfig = {
    mcpServers: renderedServers,
  };
  return renderJson(config);
}

function buildClaudeCodeSetupFiles(input: {
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): ReadonlyArray<RuntimeClientSetupFile> {
  const files: RuntimeClientSetupFile[] = [
    {
      fileId: "claude_code_runtime_server_package",
      path: `${ClaudeCodeRuntimeServerPackageDir}/package.json`,
      mode: 384,
      writeMode: "overwrite",
      content: renderRuntimeServerPackageJson(),
    },
    {
      fileId: "claude_code_runtime_server",
      path: ClaudeCodeRuntimeServerPath,
      mode: 493,
      writeMode: "overwrite",
      content: ClaudeCodeRuntimeServerBundle,
    },
  ];

  if (input.mcpServers.length > 0) {
    files.push({
      fileId: "claude_code_mcp_config",
      path: ClaudeCodeMcpConfigPath,
      mode: 384,
      writeMode: "overwrite",
      content: renderClaudeCodeMcpConfig(input.mcpServers),
    });
  }

  return files;
}

function resolveAnthropicRoute(egressRoutes: ReadonlyArray<EgressCredentialRoute>): void {
  const matchingRoutes = egressRoutes.filter(isAnthropicApiRoute);
  if (matchingRoutes.length !== 1) {
    throw new Error(
      `Claude Code runtime requires exactly one Anthropic API egress route, found ${String(matchingRoutes.length)}.`,
    );
  }
}

function buildClaudeCodeRuntimeEnvironment(): ClaudeCodeRuntimeEnvironment {
  return {
    ANTHROPIC_API_KEY: MistleManagedApiKey,
    MISTLE_CLAUDE_CODE_RUNTIME_HEALTH_PATH: ClaudeCodeRuntimeServerHealthPath,
    MISTLE_CLAUDE_CODE_RUNTIME_HOST: ClaudeCodeRuntimeServerHost,
    MISTLE_CLAUDE_CODE_RUNTIME_PORT: String(ClaudeCodeRuntimeServerPort),
    MISTLE_CLAUDE_CODE_RUNTIME_WS_PATH: ClaudeCodeRuntimeServerWsPath,
  };
}

function buildMiseExecArgs(command: string, args: ReadonlyArray<string>): string[] {
  return ["mise", "exec", ClaudeCodeNodeTool, "--", command, ...args];
}

function buildClaudeCodeExecutableInstallScript(): string {
  return [
    `cat > "$1" <<'EOF'`,
    "#!/bin/sh",
    `sdk_bin_dir=${ClaudeCodeRuntimeServerPackageDir}/node_modules/@anthropic-ai`,
    'case "$(uname -m)" in',
    '  x86_64|amd64) package_candidates="claude-agent-sdk-linux-x64 claude-agent-sdk-linux-x64-musl" ;;',
    '  aarch64|arm64) package_candidates="claude-agent-sdk-linux-arm64 claude-agent-sdk-linux-arm64-musl" ;;',
    '  *) package_candidates="" ;;',
    "esac",
    "for package_name in $package_candidates claude-agent-sdk-linux-x64 claude-agent-sdk-linux-arm64 claude-agent-sdk-linux-x64-musl claude-agent-sdk-linux-arm64-musl; do",
    '  executable="$sdk_bin_dir/$package_name/claude"',
    '  if [ -x "$executable" ]; then',
    '    exec "$executable" "$@"',
    "  fi",
    "done",
    'echo "Claude Code SDK bundled binary was not found." >&2',
    "exit 127",
    "EOF",
    `chmod 755 "$1"`,
  ].join("\n");
}

function buildClaudeCodeRuntimeClients(input: {
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): ReadonlyArray<RuntimeClient> {
  resolveAnthropicRoute(input.egressRoutes);

  return [
    {
      clientId: ClaudeCodeRuntimeClientId,
      setup: {
        env: buildClaudeCodeRuntimeEnvironment(),
        files: buildClaudeCodeSetupFiles({
          mcpServers: input.mcpServers,
        }),
      },
      processes: [
        {
          processKey: ClaudeCodeRuntimeServerProcessKey,
          command: {
            args: buildMiseExecArgs("node", [ClaudeCodeRuntimeServerPath]),
            cwd: ClaudeCodeRuntimeServerPackageDir,
          },
          readiness: {
            type: "http",
            url: ClaudeCodeRuntimeServerHealthUrl,
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
          endpointKey: ClaudeCodeRuntimeServerEndpointKey,
          processKey: ClaudeCodeRuntimeServerProcessKey,
          transport: {
            type: "ws",
            url: ClaudeCodeRuntimeServerWsUrl,
          },
          connectionMode: "dedicated",
        },
      ],
    },
  ];
}

export function compileClaudeCodeRuntime(
  input: CompileAgentRuntimeInput<Record<string, never>>,
): CompileAgentRuntimeResult {
  return {
    artifacts: [
      {
        artifactKey: NodeArtifactKey,
        name: "Claude Code Node runtime",
        lifecycle: {
          install: ({ refs }) => [
            refs.mise.install({
              tools: [ClaudeCodeNodeTool],
              timeoutMs: ArtifactCommandTimeoutMs,
            }),
          ],
        },
      },
      {
        artifactKey: RuntimeServerArtifactKey,
        name: "Claude Code runtime server dependencies",
        lifecycle: {
          install: ({ refs }) => [
            refs.command.exec({
              args: ["mkdir", "-p", ClaudeCodeRuntimeServerPackageDir],
              timeoutMs: ArtifactCommandTimeoutMs,
            }),
            refs.command.exec({
              args: buildMiseExecArgs("npm", [
                "install",
                "--prefix",
                ClaudeCodeRuntimeServerPackageDir,
                "--omit=dev",
                "--no-audit",
                "--no-fund",
                `@anthropic-ai/claude-agent-sdk@${ClaudeAgentSdkVersion}`,
                "ws@8.21.0",
              ]),
              timeoutMs: ArtifactCommandTimeoutMs,
            }),
            refs.command.exec({
              args: [
                "sh",
                "-c",
                buildClaudeCodeExecutableInstallScript(),
                "sh",
                ClaudeCodeExecutablePath,
              ],
              timeoutMs: ArtifactCommandTimeoutMs,
            }),
          ],
        },
      },
    ],
    renderRuntimeClients: ({ egressRoutes }) =>
      buildClaudeCodeRuntimeClients({
        egressRoutes,
        mcpServers: input.mcpServers,
      }),
    agentRuntimes: [
      {
        runtimeId: ClaudeCodeRuntimeId,
        runtimeKey: ClaudeCodeRuntimeServerProcessKey,
        clientId: ClaudeCodeRuntimeClientId,
        endpointKey: ClaudeCodeRuntimeServerEndpointKey,
        ptyLaunch: ClaudeCodePtyLaunchSpec,
      },
    ],
  };
}
