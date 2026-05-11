import type {
  CompileAgentRuntimeResult,
  EgressCredentialRoute,
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compileOpenCodeRuntime } from "./compile-runtime.js";
import { OpenCodeRuntimeDefinition } from "./definition.js";

function createCompiledRoute(input: {
  egressRuleId: string;
  bindingId: string;
  familyId: string;
  variantId: string;
  host: string;
  baseUrl: string;
  secretType: string;
  pathPrefixes?: ReadonlyArray<string>;
  additionalHeaders?: Record<string, string>;
}): EgressCredentialRoute {
  return {
    egressRuleId: input.egressRuleId,
    bindingId: input.bindingId,
    familyId: input.familyId,
    variantId: input.variantId,
    match: {
      hosts: [input.host],
      methods: ["GET", "POST"],
      pathPrefixes: input.pathPrefixes === undefined ? ["/"] : [...input.pathPrefixes],
    },
    upstream: {
      baseUrl: input.baseUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    ...(input.additionalHeaders === undefined
      ? {}
      : { additionalHeaders: input.additionalHeaders }),
    credentialResolver: {
      kind: "integration_connection",
      connectionId: `conn_${input.familyId}`,
      secretType: input.secretType,
    },
  };
}

function renderRuntimeClients(input: {
  compiled: CompileAgentRuntimeResult;
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
}) {
  if (input.compiled.renderRuntimeClients === undefined) {
    throw new Error("Expected OpenCode runtime client renderer.");
  }

  return input.compiled.renderRuntimeClients({
    egressRoutes: input.egressRoutes,
    bindingEgressRoutes: input.egressRoutes.filter(
      (route) => route.bindingId === "bind_openai_agent",
    ),
  });
}

function readOpenCodeAuthContent(
  compiled: CompileAgentRuntimeResult,
  egressRoutes: ReadonlyArray<EgressCredentialRoute>,
) {
  const runtimeClients = renderRuntimeClients({
    compiled,
    egressRoutes,
  });
  const authFile = runtimeClients[0]?.setup.files.find((file) => file.fileId === "opencode_auth");
  return authFile === undefined ? undefined : JSON.parse(authFile.content);
}

function compileDefaultOpenCodeRuntime(): CompileAgentRuntimeResult {
  return compileOpenCodeRuntime({
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
}

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
    expect(JSON.parse(configContent)).toEqual({
      server: {
        hostname: "127.0.0.1",
        port: 4511,
        mdns: false,
      },
    });
  });

  it("does not render auth content when no supported provider egress route is present", () => {
    const compiled = compileDefaultOpenCodeRuntime();

    const rendered = renderRuntimeClients({
      compiled,
      egressRoutes: [
        createCompiledRoute({
          egressRuleId: "egress_rule_bind_github",
          bindingId: "bind_github",
          familyId: "github",
          variantId: "github-cloud",
          host: "api.github.com",
          baseUrl: "https://api.github.com",
          secretType: "api_key",
        }),
      ],
    });

    expect(rendered[0]?.setup.env).toEqual({});
    expect(rendered[0]?.setup.files.some((file) => file.fileId === "opencode_auth")).toBe(false);
  });

  it("renders OpenAI API auth file from proxied egress routes", () => {
    const runtimeClients = renderRuntimeClients({
      compiled: compileDefaultOpenCodeRuntime(),
      egressRoutes: [
        createCompiledRoute({
          egressRuleId: "egress_rule_bind_openai",
          bindingId: "bind_openai",
          familyId: "openai",
          variantId: "openai-default",
          host: "api.openai.com",
          baseUrl: "https://api.openai.com",
          secretType: "api_key",
        }),
      ],
    });
    const authFile = runtimeClients[0]?.setup.files.find((file) => file.fileId === "opencode_auth");

    expect(authFile).toMatchObject({
      fileId: "opencode_auth",
      path: "/root/.local/share/opencode/auth.json",
      mode: 384,
      writeMode: "overwrite",
    });
    expect(authFile === undefined ? undefined : JSON.parse(authFile.content)).toEqual({
      openai: {
        type: "api",
        key: "mistle-managed-credential",
      },
    });
  });

  it("renders ChatGPT subscription auth file from proxied egress routes", () => {
    expect(
      readOpenCodeAuthContent(compileDefaultOpenCodeRuntime(), [
        createCompiledRoute({
          egressRuleId: "egress_rule_bind_chatgpt",
          bindingId: "bind_chatgpt",
          familyId: "openai",
          variantId: "openai-default",
          host: "chatgpt.com",
          baseUrl: "https://chatgpt.com",
          secretType: "oauth2_access_token",
          additionalHeaders: {
            "ChatGPT-Account-ID": "acct_123",
          },
        }),
      ]),
    ).toEqual({
      openai: {
        type: "oauth",
        refresh: "mistle-managed-refresh",
        access: "mistle-managed-access",
        expires: 4_102_444_800_000,
        accountId: "acct_123",
      },
    });
  });

  it("renders Anthropic API auth file from proxied egress routes", () => {
    expect(
      readOpenCodeAuthContent(compileDefaultOpenCodeRuntime(), [
        createCompiledRoute({
          egressRuleId: "egress_rule_bind_anthropic",
          bindingId: "bind_anthropic",
          familyId: "anthropic",
          variantId: "anthropic-default",
          host: "api.anthropic.com",
          baseUrl: "https://api.anthropic.com",
          secretType: "api_key",
        }),
      ]),
    ).toEqual({
      anthropic: {
        type: "api",
        key: "mistle-managed-credential",
      },
    });
  });

  it("renders OpenCode Go auth file from proxied egress routes", () => {
    expect(
      readOpenCodeAuthContent(compileDefaultOpenCodeRuntime(), [
        createCompiledRoute({
          egressRuleId: "egress_rule_bind_opencode_go",
          bindingId: "bind_opencode_go",
          familyId: "opencode",
          variantId: "opencode-go",
          host: "opencode.ai",
          baseUrl: "https://opencode.ai/zen/go/v1",
          secretType: "api_key",
        }),
      ]),
    ).toEqual({
      "opencode-go": {
        type: "api",
        key: "mistle-managed-credential",
      },
    });
  });

  it("fails fast when OpenAI API and ChatGPT subscription routes are both proxied", () => {
    expect(() =>
      renderRuntimeClients({
        compiled: compileDefaultOpenCodeRuntime(),
        egressRoutes: [
          createCompiledRoute({
            egressRuleId: "egress_rule_bind_openai",
            bindingId: "bind_openai",
            familyId: "openai",
            variantId: "openai-default",
            host: "api.openai.com",
            baseUrl: "https://api.openai.com",
            secretType: "api_key",
          }),
          createCompiledRoute({
            egressRuleId: "egress_rule_bind_chatgpt",
            bindingId: "bind_chatgpt",
            familyId: "openai",
            variantId: "openai-default",
            host: "chatgpt.com",
            baseUrl: "https://chatgpt.com",
            secretType: "oauth2_access_token",
          }),
        ],
      }),
    ).toThrow("OpenCode runtime cannot represent multiple auth shapes for provider 'openai'.");
  });
});
