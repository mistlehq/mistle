import {
  IntegrationConnectionStatuses,
  IntegrationKinds,
  resolveIntegrationForm,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { createBrowserDefinitionsBundle } from "../../../browser.js";
import { createBrowserIntegrationRegistry } from "../../../browser.js";
import { createIntegrationRegistry } from "../../../server.js";
import {
  GoogleConnectionMethodIds,
  GoogleConnectionStartConfigSchema,
  GoogleCredentialSecretTypes,
  GoogleDefaultVariantId,
  GoogleFamilyId,
  GoogleOAuthConnectionConfigSchema,
  GoogleOAuthCredentialSlotKeys,
  GoogleServiceAccountConnectionConfigSchema,
  GoogleServiceAccountDomainWideDelegationConnectionConfigSchema,
} from "./auth.js";
import { GoogleBaseDefinition } from "./base-definition.js";
import { GoogleCapabilityIds, listRequiredGoogleCapabilityScopes } from "./capabilities/catalog.js";
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
    expect(GoogleDefinition.credentialResolvers?.default).toBeDefined();
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

  it("does not expose runtime resources when no Google capabilities are selected", () => {
    expect(GoogleDefinition.mcp).toBeDefined();
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
          config: {
            capabilities: [],
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
    ).toEqual({
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [],
    });
  });

  it("defines a grouped binding form for Google sandbox capabilities", () => {
    const form = resolveIntegrationForm({
      schema: GoogleDefinition.bindingConfigSchema,
      form: GoogleDefinition.bindingConfigForm,
      context: {
        familyId: GoogleFamilyId,
        variantId: GoogleDefaultVariantId,
        kind: "connector",
        target: {
          rawConfig: {},
          config: {},
        },
        connection: {
          id: "icn_google",
          rawConfig: {
            connection_method: GoogleConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
            client_id: "google-client.apps.googleusercontent.com",
            scopes: ["https://www.googleapis.com/auth/cloud-platform"],
          },
          config: {
            connection_method: GoogleConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
            client_id: "google-client.apps.googleusercontent.com",
            scopes: ["https://www.googleapis.com/auth/cloud-platform"],
          },
        },
        currentValue: {},
        definitions: createBrowserDefinitionsBundle(),
      },
    });

    expect(form).toMatchObject({
      schema: {
        properties: {
          capabilities: {
            title: "Google tools",
            type: "array",
          },
        },
      },
      uiSchema: {
        capabilities: {
          "ui:widget": "grouped-checkboxes",
          "ui:options": {
            groups: [
              {
                label: "Marketing & analytics",
                values: [
                  GoogleCapabilityIds.GOOGLE_ANALYTICS,
                  GoogleCapabilityIds.GOOGLE_SEARCH_CONSOLE,
                  GoogleCapabilityIds.GOOGLE_BUSINESS_PROFILE,
                ],
              },
              {
                label: "Google Cloud",
                values: [
                  GoogleCapabilityIds.GCP_CLOUD_LOGGING,
                  GoogleCapabilityIds.GCP_CLOUD_RUN,
                  GoogleCapabilityIds.GCP_CLOUD_STORAGE,
                  GoogleCapabilityIds.GCP_CLOUD_RESOURCE_MANAGER,
                  GoogleCapabilityIds.GCP_GKE,
                ],
              },
            ],
          },
        },
      },
    });
  });

  it("rejects unknown and duplicate Google sandbox capability ids", () => {
    expect(() =>
      GoogleDefinition.bindingConfigSchema.parse({
        capabilities: ["unknown_google_tool"],
      }),
    ).toThrow(/Unsupported Google capability id 'unknown_google_tool'/);

    expect(() =>
      GoogleDefinition.bindingConfigSchema.parse({
        capabilities: [GoogleCapabilityIds.GOOGLE_ANALYTICS, GoogleCapabilityIds.GOOGLE_ANALYTICS],
      }),
    ).toThrow(/Duplicate Google capability id 'google_analytics'/);
  });

  it("lists required scopes as informational metadata without enforcing them", () => {
    expect(
      listRequiredGoogleCapabilityScopes([
        GoogleCapabilityIds.GOOGLE_ANALYTICS,
        GoogleCapabilityIds.GCP_CLOUD_RUN,
      ]),
    ).toEqual([
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/cloud-platform",
    ]);
  });

  it("compiles selected Google Analytics, Search Console, Business Profile, and Cloud capabilities", () => {
    const compileResult = GoogleDefinition.compileBinding({
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
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: GoogleConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
          client_id: "google-client.apps.googleusercontent.com",
          scopes: ["openid"],
        },
      },
      binding: {
        id: "ibd_123",
        kind: IntegrationKinds.CONNECTOR,
        config: {
          capabilities: [
            GoogleCapabilityIds.GOOGLE_ANALYTICS,
            GoogleCapabilityIds.GOOGLE_SEARCH_CONSOLE,
            GoogleCapabilityIds.GOOGLE_BUSINESS_PROFILE,
            GoogleCapabilityIds.GCP_CLOUD_RUN,
          ],
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

    expect(compileResult.artifacts.map((artifact) => artifact.artifactKey)).toEqual([
      "google-analytics-cli",
      "google-search-console-cli",
      "google-business-profile-cli",
    ]);
    expect(compileResult.runtimeClients.map((client) => client.clientId)).toEqual([
      "google-analytics-mcp",
      "google-search-console-mcp",
      "google-business-profile-mcp",
    ]);
    expect(compileResult.egressRoutes.map((route) => route.match.hosts)).toEqual([
      ["analyticsadmin.googleapis.com"],
      ["analyticsdata.googleapis.com"],
      ["searchconsole.googleapis.com"],
      ["mybusinessaccountmanagement.googleapis.com"],
      ["mybusinessbusinessinformation.googleapis.com"],
      ["businessprofileperformance.googleapis.com"],
      ["mybusiness.googleapis.com"],
      ["run.googleapis.com"],
    ]);
    expect(compileResult.egressRoutes.map((route) => route.credentialResolver)).toContainEqual({
      kind: "integration_connection",
      connectionId: "icn_google",
      secretType: "oauth2_access_token",
      slotKey: "google.google-default.oauth2-authorization-code.access-token",
    });
  });

  it("compiles service-account backed Google capabilities to the default access-token resolver slot", () => {
    const compileResult = GoogleDefinition.compileBinding({
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
        id: "icn_google_service_account",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: GoogleConnectionMethodIds.SERVICE_ACCOUNT,
        },
      },
      binding: {
        id: "ibd_123",
        kind: IntegrationKinds.CONNECTOR,
        config: {
          capabilities: [GoogleCapabilityIds.GOOGLE_ANALYTICS],
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

    expect(compileResult.egressRoutes.map((route) => route.credentialResolver)).toEqual([
      {
        kind: "integration_connection",
        connectionId: "icn_google_service_account",
        secretType: GoogleCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
        slotKey: GoogleOAuthCredentialSlotKeys.accessToken,
      },
      {
        kind: "integration_connection",
        connectionId: "icn_google_service_account",
        secretType: GoogleCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
        slotKey: GoogleOAuthCredentialSlotKeys.accessToken,
      },
    ]);
  });

  it("resolves MCP servers for selected Google capabilities", () => {
    const mcpInput = {
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
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: GoogleConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
          client_id: "google-client.apps.googleusercontent.com",
          scopes: ["openid"],
        },
      },
      binding: {
        id: "ibd_123",
        kind: IntegrationKinds.CONNECTOR,
        config: {
          capabilities: [
            GoogleCapabilityIds.GOOGLE_ANALYTICS,
            GoogleCapabilityIds.GCP_CLOUD_STORAGE,
          ],
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
        artifactBinPath(name: string) {
          return `/usr/local/bin/${name}`;
        },
      },
    };
    const mcpDefinition = GoogleDefinition.mcp;
    if (mcpDefinition === undefined) {
      throw new Error("Expected Google MCP definition to be present.");
    }
    const mcpDefinitionValue =
      typeof mcpDefinition === "function" ? mcpDefinition(mcpInput) : mcpDefinition;
    const mcpServers = Array.isArray(mcpDefinitionValue)
      ? mcpDefinitionValue
      : [mcpDefinitionValue];

    expect(mcpServers.map((server) => server.serverName)).toEqual([
      "google_analytics",
      "cloud_storage",
    ]);
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
