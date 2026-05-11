import type {
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compileOpenCodeRuntime } from "./compile-runtime.js";
import { OpenCodeRuntimeDefinition } from "./definition.js";

function resolveArtifactLifecycleCommands(artifact: RuntimeArtifactSpec): {
  install: ReadonlyArray<RuntimeArtifactInstallStep>;
} {
  const refs = {
    command: {
      exec(input: RuntimeExecCommand): RuntimeArtifactInstallStep {
        return {
          op: "exec",
          command: input,
        };
      },
    },
    sandboxPaths: {
      userHomeDir: "/root",
      workspaceDir: "/root",
      runtimeDataDir: "/var/lib/mistle",
      runtimeArtifactDir: "/var/lib/mistle/artifacts",
      runtimeArtifactBinDir: "/usr/local/bin",
    },
    artifactBinPath: (artifactName: string) => `/usr/local/bin/${artifactName}`,
    mise: {
      install(input: {
        tools: ReadonlyArray<string>;
        force?: boolean;
        timeoutMs?: number;
      }): RuntimeArtifactInstallStep {
        return {
          op: "mise_install",
          tools: [...input.tools],
          ...(input.force === undefined ? {} : { force: input.force }),
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        };
      },
    },
    githubReleases: {
      install(input: RuntimeArtifactGitHubReleaseInstallHelperInput): RuntimeArtifactInstallStep {
        return {
          op: "github_release_install",
          ...input,
        };
      },
    },
    compileContext: {
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "openai-default",
      bindingId: "bind_openai_agent",
    },
  };

  const install =
    typeof artifact.lifecycle.install === "function"
      ? artifact.lifecycle.install({ refs })
      : artifact.lifecycle.install;

  return {
    install,
  };
}

describe("compileOpenCodeRuntime", () => {
  it("declares the OpenCode runtime definition and MCP config materialization", () => {
    expect(OpenCodeRuntimeDefinition.runtimeId).toBe("opencode");
    expect(OpenCodeRuntimeDefinition.displayName).toBe("OpenCode");
    expect(OpenCodeRuntimeDefinition.materializeMcpConfig?.()).toEqual([
      {
        clientId: "opencode-cli",
        fileId: "opencode_config",
        format: "json",
        path: ["mcp"],
      },
    ]);
  });

  it("compiles OpenCode runtime artifacts, server wiring, and proxied provider access", () => {
    const compiled = compileOpenCodeRuntime({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      bindingId: "bind_openai_agent",
      connectionId: "conn_openai_org_123",
      runtimeId: "opencode",
      runtimeConfig: {},
      providerAccess: {
        providerFamilyId: "openai",
        providerVariantId: "openai-default",
        apiBaseUrl: "https://api.openai.com/v1",
        authScheme: "bearer",
        credentialResolver: {
          connectionId: "conn_openai_org_123",
          secretType: "api_key",
          slotKey: "openai.openai-default.api-key.api-key",
        },
        allowedMethods: ["GET", "POST"],
        allowedPathPrefixes: ["/"],
        providerMetadata: {
          responsesApiBaseUrl: "https://api.openai.com/v1",
        },
      },
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

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.openai.com"],
          pathPrefixes: ["/"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://api.openai.com/v1",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "conn_openai_org_123",
          secretType: "api_key",
          slotKey: "openai.openai-default.api-key.api-key",
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts?.[0]?.artifactKey).toBe("opencode-cli");
    if (compiled.artifacts?.[0] === undefined) {
      throw new Error("Expected compiled OpenCode artifact.");
    }
    expect(resolveArtifactLifecycleCommands(compiled.artifacts[0])).toEqual({
      install: [
        {
          op: "github_release_install",
          repository: "anomalyco/opencode",
          release: {
            kind: "tag",
            match: "exact",
            tag: "v1.14.48",
          },
          asset: {
            kind: "by_arch",
            x86_64: {
              fileName: "opencode-linux-x64-baseline.tar.gz",
              format: "tar.gz",
              extractedPath: "opencode",
            },
            aarch64: {
              fileName: "opencode-linux-arm64.tar.gz",
              format: "tar.gz",
              extractedPath: "opencode",
            },
          },
          installPath: "/usr/local/bin/opencode",
          timeoutMs: 120_000,
        },
      ],
    });

    expect(compiled.runtimeClients).toHaveLength(1);
    expect(compiled.runtimeClients[0]).toMatchObject({
      clientId: "opencode-cli",
      setup: {
        env: {},
        files: [
          {
            fileId: "opencode_config",
            path: "/root/.config/opencode/opencode.json",
            mode: 384,
            writeMode: "if-absent",
          },
          {
            fileId: "opencode_global_agents",
            path: "/root/.config/opencode/AGENTS.md",
            mode: 384,
            writeMode: "if-absent",
          },
        ],
      },
    });
    expect(compiled.runtimeClients[0]?.processes).toEqual([
      {
        processKey: "opencode-server",
        command: {
          args: ["/usr/local/bin/opencode", "serve", "--hostname", "127.0.0.1", "--port", "4511"],
        },
        readiness: {
          type: "http",
          url: "http://127.0.0.1:4511/global/health",
          expectedStatus: 200,
          timeoutMs: 60_000,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: 10_000,
          gracePeriodMs: 2_000,
        },
      },
    ]);
    expect(compiled.runtimeClients[0]?.endpoints).toEqual([
      {
        endpointKey: "server",
        processKey: "opencode-server",
        transport: {
          type: "ws",
          url: "ws://127.0.0.1:4510",
        },
        connectionMode: "dedicated",
      },
    ]);

    const setupFiles = compiled.runtimeClients[0]?.setup.files;
    if (setupFiles === undefined) {
      throw new Error("Expected compiled OpenCode runtime setup files.");
    }
    const configFile = setupFiles.find((file) => file.fileId === "opencode_config");
    if (configFile === undefined) {
      throw new Error("Expected compiled OpenCode config file.");
    }
    const agentsFile = setupFiles.find((file) => file.fileId === "opencode_global_agents");
    if (agentsFile === undefined) {
      throw new Error("Expected compiled OpenCode global AGENTS.md file.");
    }

    expect(JSON.parse(configFile.content)).toEqual({
      server: {
        hostname: "127.0.0.1",
        port: 4511,
        mdns: false,
      },
      provider: {
        openai: {
          options: {
            apiKey: "mistle-managed-credential",
            baseURL: "https://api.openai.com/v1",
          },
        },
      },
    });
    expect(agentsFile.content).toContain("Mistle-managed sandbox context:");
    expect(agentsFile.content).toContain(
      "Provider credentials may be injected by the platform outside the sandboxed process environment.",
    );
    expect(compiled.agentRuntimes).toEqual([
      {
        runtimeId: "opencode",
        runtimeKey: "opencode-server",
        clientId: "opencode-cli",
        endpointKey: "server",
        ptyLaunch: {
          runtimeId: "opencode",
          displayName: "OpenCode",
          newLaunch: {
            ptySessionId: "cli",
            cols: 120,
            rows: 32,
            command: "opencode",
            args: [
              {
                kind: "literal",
                value: "run",
              },
              {
                kind: "literal",
                value: "--interactive",
              },
              {
                kind: "literal",
                value: "--attach",
              },
              {
                kind: "literal",
                value: "http://127.0.0.1:4511",
              },
            ],
          },
          resumeLaunch: {
            ptySessionId: "cli",
            cols: 120,
            rows: 32,
            command: "opencode",
            args: [
              {
                kind: "literal",
                value: "run",
              },
              {
                kind: "literal",
                value: "--interactive",
              },
              {
                kind: "literal",
                value: "--attach",
              },
              {
                kind: "literal",
                value: "http://127.0.0.1:4511",
              },
              {
                kind: "literal",
                value: "--session",
              },
              {
                kind: "threadId",
              },
            ],
          },
        },
      },
    ]);
  });

  it("preserves additional provider headers in the egress route", () => {
    const compiled = compileOpenCodeRuntime({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      bindingId: "bind_openai_agent",
      connectionId: "conn_openai_org_123",
      runtimeId: "opencode",
      runtimeConfig: {},
      providerAccess: {
        providerFamilyId: "openai",
        providerVariantId: "openai-default",
        apiBaseUrl: "https://chatgpt.com",
        authScheme: "bearer",
        credentialResolver: {
          connectionId: "conn_openai_org_123",
          secretType: "chatgpt_access_token",
        },
        additionalHeaders: {
          "ChatGPT-Account-ID": "acct_123",
        },
        allowedMethods: ["GET", "POST"],
        allowedPathPrefixes: ["/"],
        providerMetadata: {
          responsesApiBaseUrl: "https://chatgpt.com/backend-api/codex",
        },
      },
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

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["chatgpt.com"],
          pathPrefixes: ["/"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://chatgpt.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        additionalHeaders: {
          "ChatGPT-Account-ID": "acct_123",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "conn_openai_org_123",
          secretType: "chatgpt_access_token",
        },
      },
    ]);

    const configContent = compiled.runtimeClients[0]?.setup.files.find(
      (file) => file.fileId === "opencode_config",
    )?.content;
    if (configContent === undefined) {
      throw new Error("Expected compiled OpenCode config content.");
    }
    expect(JSON.parse(configContent)).toMatchObject({
      provider: {
        openai: {
          options: {
            baseURL: "https://chatgpt.com/backend-api/codex",
          },
        },
      },
    });
  });

  it("fails fast when provider URL metadata is missing", () => {
    expect(() =>
      compileOpenCodeRuntime({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        bindingId: "bind_openai_agent",
        connectionId: "conn_openai_org_123",
        runtimeId: "opencode",
        runtimeConfig: {},
        providerAccess: {
          providerFamilyId: "openai",
          providerVariantId: "openai-default",
          apiBaseUrl: "https://api.openai.com/v1",
          authScheme: "bearer",
          credentialResolver: {
            connectionId: "conn_openai_org_123",
            secretType: "api_key",
          },
          allowedMethods: ["GET", "POST"],
          allowedPathPrefixes: ["/"],
        },
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
      }),
    ).toThrow("OpenCode runtime requires provider URL metadata.");
  });
});
