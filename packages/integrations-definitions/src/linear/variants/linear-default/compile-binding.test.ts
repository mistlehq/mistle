import { describe, expect, it } from "vitest";

import {
  LinearConnectionMethodIds,
  LinearCredentialSlotKeys,
  LinearOAuth2CredentialSlotKeys,
} from "./auth.js";
import { compileLinearBinding } from "./compile-binding.js";
import { LinearRequestMiddlewareIds } from "./egress-request-middleware.js";
import { LinearToolIds } from "./tool-ids.js";

describe("compileLinearBinding", () => {
  it("always builds the expected Linear API egress route", () => {
    const compiled = compileLinearBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "linear-default",
      target: {
        familyId: "linear",
        variantId: "linear-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {
          connection_method: "api-key",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [],
        },
      },
      refs: {
        sandboxPaths: {
          userHomeDir: "/root",
          workspaceDir: "/root",
          runtimeDataDir: "/var/lib/mistle",
          runtimeArtifactDir: "/var/lib/mistle/artifacts",
          runtimeArtifactBinDir: "/usr/local/bin",
        },
        artifactBinPath: (name) => `/usr/local/bin/${name}`,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.linear.app"],
          methods: ["POST"],
          pathPrefixes: ["/graphql"],
        },
        upstream: {
          baseUrl: "https://api.linear.app",
        },
        authInjection: {
          type: "header",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: LinearCredentialSlotKeys.API_KEY,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("adds the Linear MCP route when the binding enables the MCP tool", () => {
    const compiled = compileLinearBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "linear-default",
      target: {
        familyId: "linear",
        variantId: "linear-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {
          connection_method: "api-key",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [LinearToolIds.LINEAR_MCP],
        },
      },
      refs: {
        sandboxPaths: {
          userHomeDir: "/root",
          workspaceDir: "/root",
          runtimeDataDir: "/var/lib/mistle",
          runtimeArtifactDir: "/var/lib/mistle/artifacts",
          runtimeArtifactBinDir: "/usr/local/bin",
        },
        artifactBinPath: (name) => `/usr/local/bin/${name}`,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.linear.app"],
          methods: ["POST"],
          pathPrefixes: ["/graphql"],
        },
        upstream: {
          baseUrl: "https://api.linear.app",
        },
        authInjection: {
          type: "header",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: LinearCredentialSlotKeys.API_KEY,
        },
      },
      {
        match: {
          hosts: ["mcp.linear.app"],
        },
        upstream: {
          baseUrl: "https://mcp.linear.app/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: LinearCredentialSlotKeys.API_KEY,
        },
        requestMiddleware: [LinearRequestMiddlewareIds.APPEND_SESSION_LINK_TO_MCP_MARKDOWN],
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("builds Linear OAuth egress routes with bearer credential injection", () => {
    const compiled = compileLinearBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "linear-default",
      target: {
        familyId: "linear",
        variantId: "linear-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "linear_client_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [LinearToolIds.LINEAR_MCP],
        },
      },
      refs: {
        sandboxPaths: {
          userHomeDir: "/root",
          workspaceDir: "/root",
          runtimeDataDir: "/var/lib/mistle",
          runtimeArtifactDir: "/var/lib/mistle/artifacts",
          runtimeArtifactBinDir: "/usr/local/bin",
        },
        artifactBinPath: (name) => `/usr/local/bin/${name}`,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.linear.app"],
          methods: ["POST"],
          pathPrefixes: ["/graphql"],
        },
        upstream: {
          baseUrl: "https://api.linear.app",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "oauth2_access_token",
          slotKey: LinearOAuth2CredentialSlotKeys.accessToken,
        },
      },
      {
        match: {
          hosts: ["mcp.linear.app"],
        },
        upstream: {
          baseUrl: "https://mcp.linear.app/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "oauth2_access_token",
          slotKey: LinearOAuth2CredentialSlotKeys.accessToken,
        },
        requestMiddleware: [LinearRequestMiddlewareIds.APPEND_SESSION_LINK_TO_MCP_MARKDOWN],
      },
    ]);
    expect(LinearCredentialSlotKeys.OAUTH2_ACCESS_TOKEN).toBe(
      LinearOAuth2CredentialSlotKeys.accessToken,
    );
  });

  it("rejects Linear OAuth app setup connections for runtime binding", () => {
    expect(() =>
      compileLinearBinding({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "linear-default",
        target: {
          familyId: "linear",
          variantId: "linear-default",
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_123",
          status: "active",
          config: {
            connection_method: LinearConnectionMethodIds.OAUTH_APP,
            client_id: "linear_client_123",
          },
        },
        binding: {
          id: "ibd_123",
          kind: "connector",
          config: {
            tools: [],
          },
        },
        refs: {
          sandboxPaths: {
            userHomeDir: "/root",
            workspaceDir: "/root",
            runtimeDataDir: "/var/lib/mistle",
            runtimeArtifactDir: "/var/lib/mistle/artifacts",
            runtimeArtifactBinDir: "/usr/local/bin",
          },
          artifactBinPath: (name) => `/usr/local/bin/${name}`,
        },
      }),
    ).toThrow("Unsupported Linear connection method 'linear-oauth-app'.");
  });
});
