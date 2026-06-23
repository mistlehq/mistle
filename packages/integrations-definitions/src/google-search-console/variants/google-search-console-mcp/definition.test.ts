import { describe, expect, it } from "vitest";

import { createBrowserIntegrationRegistry } from "../../../browser.js";
import { createIntegrationRegistry } from "../../../server.js";
import {
  GoogleSearchConsoleFamilyId,
  GoogleSearchConsoleMcpVariantId,
  GoogleSearchConsoleOAuthScopes,
} from "./auth.js";
import { GoogleSearchConsoleMcpBaseDefinition } from "./base-definition.js";
import { GoogleSearchConsoleDefinition } from "./definition.js";
import { GoogleSearchConsoleToolIds } from "./tool-ids.js";

describe("GoogleSearchConsoleDefinition", () => {
  it("defines Google Search Console as its own connector variant with OAuth capabilities", () => {
    expect(GoogleSearchConsoleDefinition.familyId).toBe(GoogleSearchConsoleFamilyId);
    expect(GoogleSearchConsoleDefinition.variantId).toBe(GoogleSearchConsoleMcpVariantId);
    expect(GoogleSearchConsoleDefinition.displayName).toBe("Google Search Console");
    expect(GoogleSearchConsoleDefinition.logoKey).toBe("google-search-console");
    expect(GoogleSearchConsoleDefinition.oauth2AuthorizationCode).toBeDefined();
    expect(GoogleSearchConsoleDefinition.authorizationRevocation).toBeDefined();
    expect(GoogleSearchConsoleOAuthScopes).toEqual([
      "https://www.googleapis.com/auth/webmasters.readonly",
    ]);
  });

  it("keeps browser definition server-only OAuth capability free", () => {
    expect(GoogleSearchConsoleMcpBaseDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(GoogleSearchConsoleMcpBaseDefinition.authorizationRevocation).toBeUndefined();
  });

  it("exposes the local Google Search Console MCP server only when selected", () => {
    if (typeof GoogleSearchConsoleDefinition.mcp !== "function") {
      throw new Error("Expected Google Search Console definition to provide dynamic MCP servers.");
    }

    const selectedServers = GoogleSearchConsoleDefinition.mcp({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "google-search-console-mcp",
      target: {
        familyId: GoogleSearchConsoleFamilyId,
        variantId: GoogleSearchConsoleMcpVariantId,
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_google_search_console",
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
          tools: [GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_MCP],
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
        serverId: GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_MCP,
        serverName: "google_search_console",
        transport: "streamable-http",
        url: "http://127.0.0.1:7349/mcp",
        description: "Google Search Console MCP",
      },
    ]);

    expect(
      GoogleSearchConsoleDefinition.mcp({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "google-search-console-mcp",
        target: {
          familyId: GoogleSearchConsoleFamilyId,
          variantId: GoogleSearchConsoleMcpVariantId,
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_google_search_console",
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
            tools: [GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_CLI],
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

  it("registers Google Search Console in browser and server integration registries", () => {
    const browserDefinition = createBrowserIntegrationRegistry().getDefinition({
      familyId: GoogleSearchConsoleFamilyId,
      variantId: GoogleSearchConsoleMcpVariantId,
    });
    const serverDefinition = createIntegrationRegistry().getDefinition({
      familyId: GoogleSearchConsoleFamilyId,
      variantId: GoogleSearchConsoleMcpVariantId,
    });

    expect(browserDefinition?.displayName).toBe("Google Search Console");
    expect(serverDefinition?.displayName).toBe("Google Search Console");
    expect(serverDefinition?.oauth2AuthorizationCode).toBeDefined();
  });
});
