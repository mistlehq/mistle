import type {
  CompileAgentRuntimeResult,
  EgressCredentialRoute,
  RuntimeArtifactLifecycleBuilder,
  RuntimeArtifactInstallStep,
  RuntimeArtifactRefs,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compileClaudeCodeRuntime } from "./compile-runtime.js";
import {
  ClaudeCodeExecutablePath,
  ClaudeCodeRuntimeClientId,
  ClaudeCodeRuntimeId,
  ClaudeCodeRuntimeServerEndpointKey,
  ClaudeCodeRuntimeServerHealthUrl,
  ClaudeCodeRuntimeServerPackageDir,
  ClaudeCodeRuntimeServerPath,
  ClaudeCodeRuntimeServerProcessKey,
  ClaudeCodeRuntimeServerWsUrl,
} from "./server.js";

function createAnthropicRoute(): EgressCredentialRoute {
  return {
    egressRuleId: "egr_anthropic",
    bindingId: "bnd_anthropic",
    familyId: "anthropic",
    variantId: "anthropic-default",
    match: {
      hosts: ["api.anthropic.com"],
      methods: ["GET", "POST"],
      pathPrefixes: ["/v1"],
    },
    upstream: {
      baseUrl: "https://api.anthropic.com",
    },
    authInjection: {
      type: "header",
      target: "x-api-key",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: "conn_anthropic",
      secretType: "api_key",
    },
  };
}

function compileDefaultClaudeCodeRuntime(): CompileAgentRuntimeResult {
  return compileClaudeCodeRuntime({
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    runtimeId: ClaudeCodeRuntimeId,
    runtimeConfig: {},
    mcpServers: [],
    refs: {
      sandboxPaths: {
        userHomeDir: "/root",
        workspaceDir: "/root",
        runtimeDataDir: "/var/lib/mistle",
        runtimeArtifactDir: "/var/lib/mistle/artifacts",
        runtimeArtifactBinDir: "/usr/local/bin",
      },
      artifactBinPath: (artifactName) => `/usr/local/bin/${artifactName}`,
    },
  });
}

function renderRuntimeClients(compiled: CompileAgentRuntimeResult) {
  if (compiled.renderRuntimeClients === undefined) {
    throw new Error("Expected Claude Code runtime client renderer.");
  }
  return compiled.renderRuntimeClients({
    egressRoutes: [createAnthropicRoute()],
  });
}

function renderInstallSteps(
  install: ReadonlyArray<RuntimeArtifactInstallStep> | RuntimeArtifactLifecycleBuilder,
): ReadonlyArray<RuntimeArtifactInstallStep> {
  if (typeof install !== "function") {
    return install;
  }
  return install({ refs: createRuntimeArtifactRefs() });
}

function createRuntimeArtifactRefs(): RuntimeArtifactRefs {
  return {
    command: {
      exec: (command) => ({
        op: "exec",
        command,
      }),
    },
    sandboxPaths: {
      userHomeDir: "/root",
      workspaceDir: "/root",
      runtimeDataDir: "/var/lib/mistle",
      runtimeArtifactDir: "/var/lib/mistle/artifacts",
      runtimeArtifactBinDir: "/usr/local/bin",
    },
    artifactBinPath: (artifactName) => `/usr/local/bin/${artifactName}`,
    mise: {
      install: (input) => ({
        op: "mise_install",
        tools: input.tools,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      }),
    },
    githubReleases: {
      install: (input) => ({
        op: "github_release_install",
        repository: input.repository,
        release: input.release,
        asset: input.asset,
        installPath: input.installPath,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      }),
    },
    compileContext: {
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "target",
      bindingId: "binding",
    },
  };
}

describe("compileClaudeCodeRuntime", () => {
  it("builds a Node server process with a dedicated Mistle websocket endpoint", () => {
    const compiled = compileDefaultClaudeCodeRuntime();
    const runtimeClients = renderRuntimeClients(compiled);

    expect(runtimeClients).toHaveLength(1);
    expect(runtimeClients[0]).toMatchObject({
      clientId: ClaudeCodeRuntimeClientId,
      setup: {
        env: {
          ANTHROPIC_API_KEY: "mistle-managed-credential",
          MISTLE_CLAUDE_CODE_EXECUTABLE_PATH: ClaudeCodeExecutablePath,
        },
      },
      processes: [
        {
          processKey: ClaudeCodeRuntimeServerProcessKey,
          command: {
            args: ["node", ClaudeCodeRuntimeServerPath],
            cwd: ClaudeCodeRuntimeServerPackageDir,
          },
          readiness: {
            type: "http",
            url: ClaudeCodeRuntimeServerHealthUrl,
            expectedStatus: 200,
            timeoutMs: 60000,
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
    });
    expect(runtimeClients[0]?.setup.files.map((file) => file.fileId)).toEqual([
      "claude_code_runtime_server_package",
      "claude_code_runtime_server",
    ]);
    expect(compiled.agentRuntimes).toEqual([
      {
        runtimeId: ClaudeCodeRuntimeId,
        runtimeKey: ClaudeCodeRuntimeServerProcessKey,
        clientId: ClaudeCodeRuntimeClientId,
        endpointKey: ClaudeCodeRuntimeServerEndpointKey,
        ptyLaunch: expect.objectContaining({
          runtimeId: ClaudeCodeRuntimeId,
          displayName: "Claude Code",
        }),
      },
    ]);
  });

  it("fails fast when the Anthropic API egress route is missing", () => {
    const compiled = compileDefaultClaudeCodeRuntime();
    if (compiled.renderRuntimeClients === undefined) {
      throw new Error("Expected Claude Code runtime client renderer.");
    }

    expect(() => compiled.renderRuntimeClients?.({ egressRoutes: [] })).toThrow(
      "Claude Code runtime requires exactly one Anthropic API egress route, found 0.",
    );
  });

  it("installs Node and the Claude Agent SDK through runtime artifacts", () => {
    const compiled = compileDefaultClaudeCodeRuntime();
    expect(compiled.artifacts).toHaveLength(2);

    const installSteps = compiled.artifacts?.flatMap((artifact) =>
      renderInstallSteps(artifact.lifecycle.install),
    );

    expect(installSteps).toContainEqual({
      op: "mise_install",
      tools: ["node@25.0.0"],
      timeoutMs: 120000,
    });
    expect(installSteps).toContainEqual({
      op: "exec",
      command: {
        args: [
          "npm",
          "install",
          "--prefix",
          ClaudeCodeRuntimeServerPackageDir,
          "--omit=dev",
          "--no-audit",
          "--no-fund",
          "@anthropic-ai/claude-agent-sdk@0.3.175",
          "ws@8.21.0",
        ],
        timeoutMs: 120000,
      },
    });
  });
});
