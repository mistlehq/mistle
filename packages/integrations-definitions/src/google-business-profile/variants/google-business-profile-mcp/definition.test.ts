import { describe, expect, it } from "vitest";

import { createBrowserIntegrationRegistry } from "../../../browser.js";
import { createIntegrationRegistry } from "../../../server.js";
import {
  GoogleBusinessProfileFamilyId,
  GoogleBusinessProfileMcpVariantId,
  GoogleBusinessProfileOAuthScopes,
} from "./auth.js";
import { GoogleBusinessProfileMcpBaseDefinition } from "./base-definition.js";
import { GoogleBusinessProfileDefinition } from "./definition.js";
import { GoogleBusinessProfileToolIds } from "./tool-ids.js";

describe("GoogleBusinessProfileDefinition", () => {
  it("defines Google Business Profile as its own connector variant with OAuth capabilities", () => {
    expect(GoogleBusinessProfileDefinition.familyId).toBe(GoogleBusinessProfileFamilyId);
    expect(GoogleBusinessProfileDefinition.variantId).toBe(GoogleBusinessProfileMcpVariantId);
    expect(GoogleBusinessProfileDefinition.displayName).toBe("Google Business Profile");
    expect(GoogleBusinessProfileDefinition.logoKey).toBe("google-business-profile");
    expect(GoogleBusinessProfileDefinition.oauth2AuthorizationCode).toBeDefined();
    expect(GoogleBusinessProfileDefinition.authorizationRevocation).toBeDefined();
    expect(GoogleBusinessProfileOAuthScopes).toEqual([
      "https://www.googleapis.com/auth/business.manage",
    ]);
  });

  it("keeps browser definition server-only OAuth capability free", () => {
    expect(GoogleBusinessProfileMcpBaseDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(GoogleBusinessProfileMcpBaseDefinition.authorizationRevocation).toBeUndefined();
  });

  it("exposes the local Google Business Profile MCP server only when selected", () => {
    if (typeof GoogleBusinessProfileDefinition.mcp !== "function") {
      throw new Error(
        "Expected Google Business Profile definition to provide dynamic MCP servers.",
      );
    }

    const selectedServers = GoogleBusinessProfileDefinition.mcp({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "google-business-profile-mcp",
      target: {
        familyId: GoogleBusinessProfileFamilyId,
        variantId: GoogleBusinessProfileMcpVariantId,
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_google_business_profile",
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
          tools: [GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_MCP],
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
        serverId: GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_MCP,
        serverName: "google_business_profile",
        transport: "streamable-http",
        url: "http://127.0.0.1:7351/mcp",
        description: "Google Business Profile MCP",
      },
    ]);

    expect(
      GoogleBusinessProfileDefinition.mcp({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "google-business-profile-mcp",
        target: {
          familyId: GoogleBusinessProfileFamilyId,
          variantId: GoogleBusinessProfileMcpVariantId,
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_google_business_profile",
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
            tools: [GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_CLI],
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

  it("registers Google Business Profile in browser and server integration registries", () => {
    const browserDefinition = createBrowserIntegrationRegistry().getDefinition({
      familyId: GoogleBusinessProfileFamilyId,
      variantId: GoogleBusinessProfileMcpVariantId,
    });
    const serverDefinition = createIntegrationRegistry().getDefinition({
      familyId: GoogleBusinessProfileFamilyId,
      variantId: GoogleBusinessProfileMcpVariantId,
    });

    expect(browserDefinition?.displayName).toBe("Google Business Profile");
    expect(serverDefinition?.displayName).toBe("Google Business Profile");
    expect(serverDefinition?.oauth2AuthorizationCode).toBeDefined();
  });
});
