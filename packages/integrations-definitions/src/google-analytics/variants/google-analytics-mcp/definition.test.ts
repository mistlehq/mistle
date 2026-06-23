import { describe, expect, it } from "vitest";

import { createBrowserIntegrationRegistry } from "../../../browser.js";
import { createIntegrationRegistry } from "../../../server.js";
import {
  GoogleAnalyticsFamilyId,
  GoogleAnalyticsMcpVariantId,
  GoogleAnalyticsOAuthScopes,
} from "./auth.js";
import { GoogleAnalyticsMcpBaseDefinition } from "./base-definition.js";
import { GoogleAnalyticsDefinition } from "./definition.js";
import { GoogleAnalyticsToolIds } from "./tool-ids.js";

describe("GoogleAnalyticsDefinition", () => {
  it("defines Google Analytics as its own connector variant with OAuth capabilities", () => {
    expect(GoogleAnalyticsDefinition.familyId).toBe(GoogleAnalyticsFamilyId);
    expect(GoogleAnalyticsDefinition.variantId).toBe(GoogleAnalyticsMcpVariantId);
    expect(GoogleAnalyticsDefinition.displayName).toBe("Google Analytics");
    expect(GoogleAnalyticsDefinition.logoKey).toBe("google-analytics");
    expect(GoogleAnalyticsDefinition.oauth2AuthorizationCode).toBeDefined();
    expect(GoogleAnalyticsDefinition.authorizationRevocation).toBeDefined();
    expect(GoogleAnalyticsOAuthScopes).toEqual([
      "https://www.googleapis.com/auth/analytics.readonly",
    ]);
  });

  it("keeps browser definition server-only OAuth capability free", () => {
    expect(GoogleAnalyticsMcpBaseDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(GoogleAnalyticsMcpBaseDefinition.authorizationRevocation).toBeUndefined();
  });

  it("exposes the local Google Analytics MCP server only when selected", () => {
    if (typeof GoogleAnalyticsDefinition.mcp !== "function") {
      throw new Error("Expected Google Analytics definition to provide dynamic MCP servers.");
    }

    const selectedServers = GoogleAnalyticsDefinition.mcp({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "google-analytics-mcp",
      target: {
        familyId: GoogleAnalyticsFamilyId,
        variantId: GoogleAnalyticsMcpVariantId,
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_google_analytics",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "google-client.apps.googleusercontent.com",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_MCP],
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
        artifactBinPath(name) {
          return `/usr/local/bin/${name}`;
        },
      },
    });

    expect(selectedServers).toEqual([
      {
        serverId: GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_MCP,
        serverName: "google_analytics",
        transport: "streamable-http",
        url: "http://127.0.0.1:7347/mcp",
        description: "Google Analytics MCP",
      },
    ]);

    expect(
      GoogleAnalyticsDefinition.mcp({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "google-analytics-mcp",
        target: {
          familyId: GoogleAnalyticsFamilyId,
          variantId: GoogleAnalyticsMcpVariantId,
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_google_analytics",
          status: "active",
          config: {
            connection_method: "oauth2-authorization-code",
            client_id: "google-client.apps.googleusercontent.com",
          },
        },
        binding: {
          id: "ibd_123",
          kind: "connector",
          config: {
            tools: [GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_CLI],
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
          artifactBinPath(name) {
            return `/usr/local/bin/${name}`;
          },
        },
      }),
    ).toEqual([]);
  });

  it("registers Google Analytics in browser and server integration registries", () => {
    const browserDefinition = createBrowserIntegrationRegistry().getDefinition({
      familyId: GoogleAnalyticsFamilyId,
      variantId: GoogleAnalyticsMcpVariantId,
    });
    const serverDefinition = createIntegrationRegistry().getDefinition({
      familyId: GoogleAnalyticsFamilyId,
      variantId: GoogleAnalyticsMcpVariantId,
    });

    expect(browserDefinition?.displayName).toBe("Google Analytics");
    expect(serverDefinition?.displayName).toBe("Google Analytics");
    expect(serverDefinition?.oauth2AuthorizationCode).toBeDefined();
  });
});
