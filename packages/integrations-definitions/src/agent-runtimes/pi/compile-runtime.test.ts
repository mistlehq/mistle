import { Buffer } from "node:buffer";

import type {
  CompileAgentRuntimeResult,
  EgressCredentialRoute,
  ResolvedIntegrationMcpServer,
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
  RuntimeClient,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compilePiRuntime } from "./compile-runtime.js";
import { PiRuntimeDefinition } from "./definition.js";

function createCompiledRoute(input: {
  egressRuleId: string;
  bindingId: string;
  familyId: string;
  variantId: string;
  host: string;
  baseUrl: string;
  secretType: string;
  authInjection?: EgressCredentialRoute["authInjection"];
  additionalHeaders?: EgressCredentialRoute["additionalHeaders"];
}): EgressCredentialRoute {
  return {
    egressRuleId: input.egressRuleId,
    bindingId: input.bindingId,
    familyId: input.familyId,
    variantId: input.variantId,
    match: {
      hosts: [input.host],
      methods: ["GET", "POST"],
      pathPrefixes: ["/"],
    },
    upstream: {
      baseUrl: input.baseUrl,
    },
    ...(input.additionalHeaders === undefined
      ? {}
      : { additionalHeaders: input.additionalHeaders }),
    authInjection: input.authInjection ?? {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: `conn_${input.familyId}`,
      secretType: input.secretType,
    },
  };
}

function compileDefaultPiRuntime(input?: {
  enableMcp?: boolean;
  mcpServers?: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): CompileAgentRuntimeResult {
  return compilePiRuntime({
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    runtimeId: "pi",
    runtimeConfig: {
      enableMcp: input?.enableMcp ?? true,
    },
    mcpServers: input?.mcpServers ?? [],
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

function renderRuntimeClients(input: {
  compiled: CompileAgentRuntimeResult;
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
}): ReadonlyArray<RuntimeClient> {
  if (input.compiled.renderRuntimeClients === undefined) {
    throw new Error("Expected Pi runtime client renderer.");
  }

  return input.compiled.renderRuntimeClients({
    egressRoutes: input.egressRoutes,
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
      targetKey: "agent-runtime",
      bindingId: "agent-runtime-pi",
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

function readSetupFile(input: {
  runtimeClients: ReadonlyArray<RuntimeClient>;
  fileId: string;
}): string {
  const content = input.runtimeClients[0]?.setup.files.find(
    (file) => file.fileId === input.fileId,
  )?.content;
  if (content === undefined) {
    throw new Error(`Expected setup file ${input.fileId}.`);
  }

  return content;
}

function decodeJwtPayload(token: string): unknown {
  const tokenParts = token.split(".");
  if (tokenParts.length !== 3) {
    throw new Error("Expected JWT-shaped token.");
  }

  return JSON.parse(Buffer.from(tokenParts[1] ?? "", "base64url").toString("utf8"));
}

describe("compilePiRuntime", () => {
  it("declares the Pi runtime definition without generic MCP materialization", () => {
    expect(PiRuntimeDefinition.runtimeId).toBe("pi");
    expect(PiRuntimeDefinition.displayName).toBe("Pi");
    expect("materializeMcpConfig" in PiRuntimeDefinition).toBe(false);
  });

  it("pins Pi to the v0.75.0 direct Linux release distribution archives", () => {
    const compiled = compileDefaultPiRuntime();
    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts?.[0];
    if (artifact === undefined) {
      throw new Error("Expected compiled Pi artifact.");
    }

    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          op: "github_release_install",
          repository: "earendil-works/pi",
          release: {
            kind: "tag",
            match: "exact",
            tag: "v0.75.0",
          },
          asset: {
            kind: "by_arch",
            x86_64: {
              fileName: "pi-linux-x64.tar.gz",
              format: "tar.gz",
              extractedPath: "pi",
              sha256: "c63de922a6adbb5031ae046fc341ce15d51021846023bc492dfd72552ab7b1f0",
            },
            aarch64: {
              fileName: "pi-linux-arm64.tar.gz",
              format: "tar.gz",
              extractedPath: "pi",
              sha256: "eecdcf68d9818508e2f2b8ad68d90e5afa792249d5f233128e49544e1e4dc92d",
            },
          },
          installPath: "/var/lib/mistle/artifacts/pi-cli",
          timeoutMs: 120_000,
        },
      ],
    });
  });

  it("renders Pi managed config and endpoint wiring", () => {
    const runtimeClients = renderRuntimeClients({
      compiled: compileDefaultPiRuntime(),
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

    expect(runtimeClients).toHaveLength(1);
    expect(runtimeClients[0]).toMatchObject({
      clientId: "pi-cli",
      setup: {
        env: {
          MISTLE_PI_CLI_PATH: "/var/lib/mistle/artifacts/pi-cli/pi",
          PI_CODING_AGENT_DIR: "/root/.pi/agent",
          PI_CODING_AGENT_SESSION_DIR: "/root/.pi/agent/sessions",
        },
      },
      processes: [],
      endpoints: [
        {
          endpointKey: "rpc",
          transport: {
            type: "ws",
            url: "ws://127.0.0.1:4520",
          },
          connectionMode: "dedicated",
        },
      ],
    });
    expect(readSetupFile({ runtimeClients, fileId: "pi_cli_wrapper" })).toBe(
      '#!/bin/sh\nset -eu\nexec /var/lib/mistle/artifacts/pi-cli/pi "$@"\n',
    );
    expect(JSON.parse(readSetupFile({ runtimeClients, fileId: "pi_models" }))).toEqual({
      providers: {
        openai: {
          apiKey: "mistle-managed-credential",
          headers: {},
        },
      },
    });
    expect(JSON.parse(readSetupFile({ runtimeClients, fileId: "pi_settings" }))).toEqual({
      sessionDir: "/root/.pi/agent/sessions",
      steeringMode: "all",
      followUpMode: "all",
    });
    expect(readSetupFile({ runtimeClients, fileId: "pi_managed_instructions" })).toContain(
      "Provider credentials may be injected by the platform outside the sandboxed process environment.",
    );
    expect(runtimeClients[0]?.setup.files.some((file) => file.fileId === "pi_mcp_config")).toBe(
      false,
    );
  });

  it("fails fast when multiple supported routes map to the same Pi built-in provider id", () => {
    const compiled = compileDefaultPiRuntime();

    expect(() =>
      renderRuntimeClients({
        compiled,
        egressRoutes: [
          createCompiledRoute({
            egressRuleId: "egress_rule_bind_openai_one",
            bindingId: "bind_openai_one",
            familyId: "openai",
            variantId: "openai-default",
            host: "api.openai.com",
            baseUrl: "https://api.openai.com",
            secretType: "api_key",
          }),
          createCompiledRoute({
            egressRuleId: "egress_rule_bind_openai_two",
            bindingId: "bind_openai_two",
            familyId: "openai",
            variantId: "openai-default",
            host: "api.openai.com",
            baseUrl: "https://api.openai.com",
            secretType: "api_key",
          }),
        ],
      }),
    ).toThrow(
      "Pi provider 'openai' cannot be represented unambiguously because 2 supported egress routes matched the same built-in provider id.",
    );
  });

  it("renders Anthropic provider auth when only Anthropic egress is available", () => {
    const runtimeClients = renderRuntimeClients({
      compiled: compileDefaultPiRuntime(),
      egressRoutes: [
        createCompiledRoute({
          egressRuleId: "egress_rule_bind_anthropic",
          bindingId: "bind_anthropic",
          familyId: "anthropic",
          variantId: "anthropic-default",
          host: "api.anthropic.com",
          baseUrl: "https://api.anthropic.com",
          secretType: "api_key",
          authInjection: {
            type: "header",
            target: "x-api-key",
          },
        }),
      ],
    });

    expect(JSON.parse(readSetupFile({ runtimeClients, fileId: "pi_models" }))).toEqual({
      providers: {
        anthropic: {
          apiKey: "mistle-managed-credential",
          headers: {},
        },
      },
    });
    expect(JSON.parse(readSetupFile({ runtimeClients, fileId: "pi_settings" }))).toEqual({
      sessionDir: "/root/.pi/agent/sessions",
      steeringMode: "all",
      followUpMode: "all",
    });
  });

  it("uses Pi's OpenAI Codex provider for ChatGPT subscription egress", () => {
    const runtimeClients = renderRuntimeClients({
      compiled: compileDefaultPiRuntime(),
      egressRoutes: [
        createCompiledRoute({
          egressRuleId: "egress_rule_bind_chatgpt",
          bindingId: "bind_chatgpt",
          familyId: "openai",
          variantId: "openai-default",
          host: "chatgpt.com",
          baseUrl: "https://chatgpt.com",
          secretType: "chatgpt_access_token",
          authInjection: {
            type: "bearer",
            target: "authorization",
          },
          additionalHeaders: {
            "ChatGPT-Account-ID": "acct_123",
          },
        }),
      ],
    });

    const modelsJson = JSON.parse(readSetupFile({ runtimeClients, fileId: "pi_models" }));
    expect(decodeJwtPayload(modelsJson.providers["openai-codex"].apiKey)).toEqual({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_123",
      },
    });
    modelsJson.providers["openai-codex"].apiKey = "<checked-jwt-shaped-placeholder>";

    expect(modelsJson).toEqual({
      providers: {
        "openai-codex": {
          apiKey: "<checked-jwt-shaped-placeholder>",
          headers: {},
        },
      },
    });
    expect(JSON.parse(readSetupFile({ runtimeClients, fileId: "pi_settings" }))).toEqual({
      sessionDir: "/root/.pi/agent/sessions",
      steeringMode: "all",
      followUpMode: "all",
    });
  });

  it("fails fast when ChatGPT subscription egress does not include an account id header", () => {
    const compiled = compileDefaultPiRuntime();

    expect(() =>
      renderRuntimeClients({
        compiled,
        egressRoutes: [
          createCompiledRoute({
            egressRuleId: "egress_rule_bind_chatgpt",
            bindingId: "bind_chatgpt",
            familyId: "openai",
            variantId: "openai-default",
            host: "chatgpt.com",
            baseUrl: "https://chatgpt.com",
            secretType: "chatgpt_access_token",
            authInjection: {
              type: "bearer",
              target: "authorization",
            },
          }),
        ],
      }),
    ).toThrow("Pi ChatGPT subscription routes require a ChatGPT-Account-ID additional header.");
  });

  it("renders Pi MCP config with headers and the proxy tool when MCP servers are present", () => {
    const mcpServers: ResolvedIntegrationMcpServer[] = [
      {
        source: {
          bindingId: "bind_remote",
          connectionId: "conn_remote",
          targetKey: "remote",
          familyId: "remote",
          variantId: "remote",
        },
        server: {
          serverId: "remote",
          serverName: "remote-http",
          transport: "streamable-http",
          url: "https://mcp.example.test/mcp",
          httpHeaders: {
            Authorization: "Bearer mistle-managed-credential",
          },
        },
      },
    ];
    const runtimeClients = renderRuntimeClients({
      compiled: compileDefaultPiRuntime({ mcpServers }),
      egressRoutes: [],
    });

    expect(JSON.parse(readSetupFile({ runtimeClients, fileId: "pi_settings" }))).toEqual({
      sessionDir: "/root/.pi/agent/sessions",
      steeringMode: "all",
      followUpMode: "all",
      extensions: ["/root/.pi/agent/extensions/pi-mcp-adapter/index.js"],
    });
    expect(readSetupFile({ runtimeClients, fileId: "pi_mcp_adapter_extension" })).toContain(
      "Prebundled pi-mcp-adapter@2.6.1 for Mistle Pi runtime.",
    );
    expect(JSON.parse(readSetupFile({ runtimeClients, fileId: "pi_mcp_config" }))).toEqual({
      settings: {
        disableProxyTool: false,
      },
      mcpServers: {
        "remote-http": {
          url: "https://mcp.example.test/mcp",
          headers: {
            Authorization: "Bearer mistle-managed-credential",
          },
          directTools: false,
          lifecycle: "lazy",
        },
      },
    });
  });

  it("omits Pi MCP files when the runtime MCP capability is disabled", () => {
    const runtimeClients = renderRuntimeClients({
      compiled: compileDefaultPiRuntime({
        enableMcp: false,
        mcpServers: [
          {
            source: {
              bindingId: "bind_remote",
              connectionId: "conn_remote",
              targetKey: "remote",
              familyId: "remote",
              variantId: "remote",
            },
            server: {
              serverId: "remote",
              serverName: "remote-http",
              transport: "streamable-http",
              url: "https://mcp.example.test/mcp",
            },
          },
        ],
      }),
      egressRoutes: [],
    });

    expect(JSON.parse(readSetupFile({ runtimeClients, fileId: "pi_settings" }))).toEqual({
      sessionDir: "/root/.pi/agent/sessions",
      steeringMode: "all",
      followUpMode: "all",
    });
    expect(runtimeClients[0]?.setup.files.some((file) => file.fileId === "pi_mcp_config")).toBe(
      false,
    );
    expect(
      runtimeClients[0]?.setup.files.some((file) => file.fileId === "pi_mcp_adapter_extension"),
    ).toBe(false);
  });
});
