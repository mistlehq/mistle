import { describe, expect, it } from "vitest";

import { createBrowserIntegrationRegistry } from "../../../browser.js";
import { createIntegrationRegistry } from "../../../server.js";
import {
  GoogleConnectionMethodIds,
  GoogleConnectionStartConfigSchema,
  GoogleDefaultVariantId,
  GoogleFamilyId,
  GoogleOAuthConnectionConfigSchema,
  GoogleServiceAccountConnectionConfigSchema,
  GoogleServiceAccountDomainWideDelegationConnectionConfigSchema,
} from "./auth.js";
import { GoogleBaseDefinition } from "./base-definition.js";
import { GoogleDefinition } from "./definition.js";

describe("GoogleDefinition", () => {
  it("defines Google as a centralized credential connector", () => {
    expect(GoogleDefinition).toMatchObject({
      familyId: GoogleFamilyId,
      variantId: GoogleDefaultVariantId,
      kind: "connector",
      displayName: "Google",
      logoKey: "google",
    });
    expect(GoogleDefinition.connectionMethods.map((method) => method.id)).toEqual([
      GoogleConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      GoogleConnectionMethodIds.SERVICE_ACCOUNT,
      GoogleConnectionMethodIds.SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION,
    ]);
    expect(GoogleDefinition.oauth2AuthorizationCode).toBeDefined();
    expect(GoogleDefinition.authorizationRevocation).toBeDefined();
  });

  it("keeps the browser definition free of server-only OAuth capability handlers", () => {
    expect(GoogleBaseDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(GoogleBaseDefinition.authorizationRevocation).toBeUndefined();
  });

  it("keeps service-account connection config scoped to the credential method", () => {
    expect(
      GoogleServiceAccountConnectionConfigSchema.parse({
        connection_method: GoogleConnectionMethodIds.SERVICE_ACCOUNT,
      }),
    ).toEqual({
      connection_method: GoogleConnectionMethodIds.SERVICE_ACCOUNT,
    });
    expect(
      GoogleServiceAccountDomainWideDelegationConnectionConfigSchema.parse({
        connection_method: GoogleConnectionMethodIds.SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION,
      }),
    ).toEqual({
      connection_method: GoogleConnectionMethodIds.SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION,
    });
    expect(() =>
      GoogleServiceAccountDomainWideDelegationConnectionConfigSchema.parse({
        connection_method: GoogleConnectionMethodIds.SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION,
        delegatedUserEmail: "user@example.com",
      }),
    ).toThrow(/delegatedUserEmail/);
  });

  it("accepts Google OAuth scope tokens and URL scopes", () => {
    const scopes = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"];

    expect(
      GoogleConnectionStartConfigSchema.parse({
        client_id: "google-client.apps.googleusercontent.com",
        client_secret: "google-secret",
        scopes,
      }),
    ).toEqual({
      client_id: "google-client.apps.googleusercontent.com",
      client_secret: "google-secret",
      scopes,
    });
    expect(
      GoogleOAuthConnectionConfigSchema.parse({
        connection_method: GoogleConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        client_id: "google-client.apps.googleusercontent.com",
        scopes,
      }),
    ).toEqual({
      connection_method: GoogleConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      client_id: "google-client.apps.googleusercontent.com",
      scopes,
    });
  });

  it("does not expose tools or runtime resources by itself", () => {
    expect(GoogleDefinition.mcp).toBeUndefined();
    expect(
      GoogleDefinition.compileBinding({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "google-default",
        target: {
          familyId: GoogleFamilyId,
          variantId: GoogleDefaultVariantId,
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_google",
          status: "active",
          config: {
            connection_method: GoogleConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
            client_id: "google-client.apps.googleusercontent.com",
            scopes: ["https://www.googleapis.com/auth/userinfo.profile"],
          },
        },
        binding: {
          id: "ibd_123",
          kind: "connector",
          config: {},
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
    ).toEqual({
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [],
    });
  });

  it("registers Google in browser and server integration registries", () => {
    const browserDefinition = createBrowserIntegrationRegistry().getDefinition({
      familyId: GoogleFamilyId,
      variantId: GoogleDefaultVariantId,
    });
    const serverDefinition = createIntegrationRegistry().getDefinition({
      familyId: GoogleFamilyId,
      variantId: GoogleDefaultVariantId,
    });

    expect(browserDefinition?.displayName).toBe("Google");
    expect(browserDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(serverDefinition?.displayName).toBe("Google");
    expect(serverDefinition?.oauth2AuthorizationCode).toBeDefined();
  });
});
