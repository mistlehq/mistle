import { describe, expect, it } from "vitest";

import { compileJiraBinding } from "./compile-binding.js";

describe("compileJiraBinding", () => {
  it("builds the expected Jira MCP egress route", () => {
    const compiled = compileJiraBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "jira-default",
      target: {
        familyId: "jira",
        variantId: "jira-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {
          auth_scheme: "api-key",
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
          hosts: ["mcp.atlassian.com"],
          pathPrefixes: ["/v1/mcp"],
        },
        upstream: {
          baseUrl: "https://mcp.atlassian.com/v1/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "icn_123",
          secretType: "api_key",
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
