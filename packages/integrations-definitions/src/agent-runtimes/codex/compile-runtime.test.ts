import { describe, expect, it } from "vitest";

import { compileCodexRuntime } from "./compile-runtime.js";

describe("compileCodexRuntime", () => {
  it("compiles Codex runtime artifacts and app-server wiring from provider access", () => {
    const compiled = compileCodexRuntime({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      bindingId: "bind_openai_agent",
      connectionId: "conn_openai_org_123",
      runtimeId: "codex",
      runtimeConfig: {},
      providerAccess: {
        providerFamilyId: "openai",
        providerVariantId: "openai-default",
        apiBaseUrl: "https://api.openai.com",
        authScheme: "bearer",
        credentialResolver: {
          connectionId: "conn_openai_org_123",
          secretType: "api_key",
        },
        allowedMethods: ["GET", "POST"],
        allowedPathPrefixes: ["/"],
        defaultModel: "gpt-5.3-codex",
        allowedModels: ["gpt-5.3-codex"],
        providerMetadata: {
          reasoningEffort: "medium",
          additionalInstructions: "Prefer concise answers.",
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
          baseUrl: "https://api.openai.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "conn_openai_org_123",
          secretType: "api_key",
        },
      },
    ]);
    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts?.[0]?.artifactKey).toBe("codex-cli");
    expect(compiled.runtimeClients).toHaveLength(1);
    expect(compiled.runtimeClients[0]).toMatchObject({
      clientId: "codex-cli",
      setup: {
        env: {
          OPENAI_MODEL: "gpt-5.3-codex",
          OPENAI_REASONING_EFFORT: "medium",
        },
      },
    });
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).toContain(
      'developer_instructions = "Mistle-managed sandbox context:',
    );
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).toContain(
      "Prefer concise answers.",
    );
    expect(compiled.agentRuntimes).toEqual([
      {
        runtimeId: "codex",
        runtimeKey: "codex-app-server",
        clientId: "codex-cli",
        endpointKey: "app-server",
      },
    ]);
  });
});
