import { describe, expect, it } from "vitest";

import { compileOpencodeRuntime } from "./compile-runtime.js";

describe("compileOpencodeRuntime", () => {
  it("compiles OpenCode runtime artifacts and headless server wiring from provider access", () => {
    const compiled = compileOpencodeRuntime({
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
        apiBaseUrl: "https://api.openai.com",
        authScheme: "bearer",
        credentialResolver: {
          connectionId: "conn_openai_org_123",
          secretType: "api_key",
        },
        allowedMethods: ["GET", "POST"],
        allowedPathPrefixes: ["/"],
        defaultModel: "gpt-5.3-codex",
        allowedModels: ["gpt-5.3-codex", "gpt-5.4"],
        providerMetadata: {
          reasoningEffort: "medium",
          additionalInstructions: "Prefer concise answers.",
        },
      },
      mcpServers: [],
      refs: {
        sandboxPaths: {
          userHomeDir: "/root",
          workspaceDir: "/workspace",
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
    expect(compiled.artifacts?.[0]?.artifactKey).toBe("opencode-cli");
    expect(compiled.runtimeClients).toHaveLength(1);
    expect(compiled.runtimeClients[0]).toMatchObject({
      clientId: "opencode-cli",
      setup: {
        env: {
          OPENCODE_CONFIG_DIR: "/etc/opencode",
          OPENCODE_CONFIG: "/etc/opencode/opencode.json",
        },
      },
    });
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).toContain(
      '"model": "openai/gpt-5.3-codex"',
    );
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).toContain('"variant": "medium"');
    expect(compiled.runtimeClients[0]?.setup.files[1]?.content).toContain(
      "Mistle-managed sandbox context:",
    );
    expect(compiled.runtimeClients[0]?.setup.files[1]?.content).toContain(
      "Prefer concise answers.",
    );
    expect(compiled.runtimeClients[0]?.processes).toEqual([
      {
        processKey: "opencode-server",
        command: {
          args: ["/usr/local/bin/opencode", "serve", "--hostname", "127.0.0.1", "--port", "4601"],
          cwd: "/workspace",
        },
        readiness: {
          type: "http",
          url: "http://127.0.0.1:4601/session/status",
          expectedStatus: 200,
          timeoutMs: 5_000,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: 10_000,
          gracePeriodMs: 2_000,
        },
      },
    ]);
    expect(compiled.runtimeClients[0]?.endpoints).toEqual([]);
    expect(compiled.agentRuntimes).toEqual([]);
  });
});
