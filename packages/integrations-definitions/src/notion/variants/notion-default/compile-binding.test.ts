import { describe, expect, it } from "vitest";

import { compileNotionBinding } from "./compile-binding.js";

describe("compileNotionBinding", () => {
  it("builds the expected Notion MCP egress route", () => {
    const compiled = compileNotionBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "notion-default",
      target: {
        familyId: "notion",
        variantId: "notion-default",
        enabled: true,
        config: {
          mcpBaseUrl: "https://notion-mcp.example.com/mcp",
          authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
          tokenEndpoint: "https://api.notion.com/v1/oauth/token",
          notionVersion: "2026-03-11",
        },
        secrets: {
          clientId: "client-id",
          clientSecret: "client-secret",
        },
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {
          connection_method: "oauth2",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {},
      },
      refs: {
        sandboxPaths: {
          userHomeDir: "/home/sandbox",
          userProjectsDir: "/home/sandbox/projects",
          runtimeDataDir: "/var/lib/mistle",
          runtimeArtifactDir: "/var/lib/mistle/artifacts",
          runtimeArtifactBinDir: "/var/lib/mistle/bin",
        },
        artifactBinPath: (name) => `/var/lib/mistle/bin/${name}`,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["notion-mcp.example.com"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://notion-mcp.example.com/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "icn_123",
          secretType: "oauth2_access_token",
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
