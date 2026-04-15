import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  integrationConnections,
  integrationTargets,
} from "@mistle/db/control-plane";
import {
  IntegrationConnectionMethodIds,
  IntegrationRegistry,
  type IntegrationDefinition,
  type IntegrationOAuth2AuthorizationCodeCapability,
} from "@mistle/integrations-core";
import { describe, expect } from "vitest";
import { z } from "zod";

import { createApp } from "../src/app.js";
import { createControlPlaneAuth } from "../src/auth/index.js";
import { CompleteOAuth2AuthorizationCodeConnectionBadRequestResponseSchema } from "../src/integration-connections/complete-oauth2-authorization-code-connection/schema.js";
import { IntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import { StartOAuth2AuthorizationCodeConnectionResponseSchema } from "../src/integration-connections/start-oauth2-authorization-code-connection/schema.js";
import { StartOAuth2AuthorizationCodeConnectionBadRequestResponseSchema } from "../src/integration-connections/start-oauth2-authorization-code-connection/schema.js";
import { UpdateIntegrationConnectionBodySchema } from "../src/integration-connections/update-integration-connection/schema.js";
import {
  decryptCredentialUtf8,
  decryptRedirectSessionSecretUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../src/lib/crypto.js";
import { createAppResources, stopAppResources } from "../src/resources.js";
import { IntegrationPortAccessConfig } from "./helpers/port-access-config.js";
import { it } from "./test-context.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";

const EmptyConfigSchema = z.object({}).strict();
const OAuth2AuthorizationCodeTestConnectionConfigSchema = z
  .object({
    region: z.string().min(1),
  })
  .strict();
const OAuth2AuthorizationCodeTestFamilyId = "oauth2-auth-code-test";
const OAuth2AuthorizationCodeTestVariantId = "oauth2-auth-code-default";

type OAuth2AuthorizationCodeTestCapability<
  TConnectionConfig extends Record<string, unknown> = Record<string, unknown>,
> = IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  TConnectionConfig
>;

function createOAuth2AuthorizationCodeTestRegistry<
  TConnectionConfig extends Record<string, unknown> = Record<string, unknown>,
>(input: {
  startAuthorization: OAuth2AuthorizationCodeTestCapability<TConnectionConfig>["startAuthorization"];
  completeAuthorizationCodeGrant: OAuth2AuthorizationCodeTestCapability<TConnectionConfig>["completeAuthorizationCodeGrant"];
  startConfigSchema?: z.ZodType<TConnectionConfig>;
}): IntegrationRegistry {
  const registry = new IntegrationRegistry();
  const definition: IntegrationDefinition<
    typeof EmptyConfigSchema,
    typeof EmptyConfigSchema,
    typeof EmptyConfigSchema,
    TConnectionConfig
  > = {
    familyId: OAuth2AuthorizationCodeTestFamilyId,
    variantId: OAuth2AuthorizationCodeTestVariantId,
    kind: "connector",
    displayName: "OAuth2 Authorization Code Test",
    logoKey: "oauth2",
    targetConfigSchema: EmptyConfigSchema,
    targetSecretSchema: EmptyConfigSchema,
    bindingConfigSchema: EmptyConfigSchema,
    connectionMethods: [
      {
        id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        label: "OAuth 2.0 Authorization Code",
        kind: "redirect",
        ...(input.startConfigSchema === undefined
          ? {}
          : { startConfigSchema: input.startConfigSchema }),
        ui: {
          create: {
            submitLabel: "Connect",
            helperText: "Connect with OAuth 2.0 Authorization Code.",
          },
        },
      },
    ],
    oauth2AuthorizationCode: {
      startAuthorization: input.startAuthorization,
      completeAuthorizationCodeGrant: input.completeAuthorizationCodeGrant,
      refreshAccessToken: async () => {
        throw new Error("Not used in OAuth 2.0 (Authorization Code) start/complete tests.");
      },
    },
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [],
    }),
  };

  registry.register(definition);

  return registry;
}

async function createOAuth2AuthorizationCodeTestApp(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  registry: IntegrationRegistry;
}) {
  const resources = await createAppResources(input.fixture.config);
  for (const definition of input.registry.listDefinitions()) {
    resources.integrationRegistry.register(definition);
  }

  const auth = createControlPlaneAuth({
    config: {
      authBaseUrl: input.fixture.config.auth.baseUrl,
      dashboardBaseUrl: input.fixture.config.dashboard.baseUrl,
      authSecret: input.fixture.config.auth.secret,
      authTrustedOrigins: input.fixture.config.auth.trustedOrigins,
      authOTPLength: input.fixture.config.auth.otpLength,
      authOTPExpiresInSeconds: input.fixture.config.auth.otpExpiresInSeconds,
      authOTPAllowedAttempts: input.fixture.config.auth.otpAllowedAttempts,
      authGoogleClientId: input.fixture.config.auth.google?.clientId ?? null,
      authGoogleClientSecret: input.fixture.config.auth.google?.clientSecret ?? null,
      activeMasterEncryptionKeyVersion:
        input.fixture.config.integrations.activeMasterEncryptionKeyVersion,
      masterEncryptionKeys: input.fixture.config.integrations.masterEncryptionKeys,
    },
    db: resources.db,
    openWorkflow: resources.openWorkflow,
  });
  const app = createApp({
    config: input.fixture.config,
    sandboxConfig: {
      defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
      gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
    },
    internalAuthServiceToken: input.fixture.internalAuthServiceToken,
    db: resources.db,
    objectStore: resources.objectStore,
    integrationRegistry: resources.integrationRegistry,
    dataPlaneClient: createDataPlaneSandboxInstancesClient({
      baseUrl: input.fixture.config.dataPlaneApi.baseUrl,
      serviceToken: input.fixture.internalAuthServiceToken,
    }),
    connectionTokenConfig: {
      secret: "integration-connection-secret",
      issuer: "integration-issuer",
      audience: "integration-audience",
    },
    portAccessConfig: IntegrationPortAccessConfig,
    openWorkflow: resources.openWorkflow,
    auth,
  });

  return {
    app,
    resources,
  };
}

function decryptRedirectProviderState(input: {
  ciphertext: string;
  masterEncryptionKeys: Record<string, string>;
}): Record<string, unknown> {
  const plaintext = decryptRedirectSessionSecretUtf8({
    ciphertext: input.ciphertext,
    masterEncryptionKeys: input.masterEncryptionKeys,
  });
  const parsed = JSON.parse(plaintext);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected redirect provider state to decode to an object.");
  }

  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    record[key] = value;
  }

  return record;
}

function decryptStoredCredential(input: {
  wrappedOrganizationKeyCiphertext: string;
  masterKeyVersion: number;
  masterEncryptionKeys: Record<string, string>;
  nonce: string;
  ciphertext: string;
}): string {
  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: input.masterKeyVersion,
    masterEncryptionKeys: input.masterEncryptionKeys,
  });
  const organizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: input.wrappedOrganizationKeyCiphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    return decryptCredentialUtf8({
      nonce: input.nonce,
      ciphertext: input.ciphertext,
      organizationCredentialKey,
    });
  } finally {
    organizationCredentialKey.fill(0);
  }
}

describe("integration connections OAuth 2.0 authorization-code integration", () => {
  it("updates redirect connection config without touching the connection method", async ({
    fixture,
  }) => {
    const targetKey = "oauth2-update-default";
    const registry = createOAuth2AuthorizationCodeTestRegistry({
      startAuthorization: async () => ({
        authorizationUrl: "https://provider.example.test/authorize",
        providerState: {},
      }),
      completeAuthorizationCodeGrant: async () => ({
        externalSubjectId: "oauth-subject-001",
        connectionConfig: {
          region: "us",
        },
        accessToken: "oauth-access-token",
        refreshToken: "oauth-refresh-token",
        expiresAt: "2026-04-15T00:30:00.000Z",
      }),
      startConfigSchema: OAuth2AuthorizationCodeTestConnectionConfigSchema,
    });
    const { app, resources } = await createOAuth2AuthorizationCodeTestApp({
      fixture,
      registry,
    });

    try {
      await fixture.db.insert(integrationTargets).values({
        targetKey,
        familyId: OAuth2AuthorizationCodeTestFamilyId,
        variantId: OAuth2AuthorizationCodeTestVariantId,
        enabled: true,
        config: {},
      });

      const authenticatedSession = await fixture.authSession({
        email: "integration-connections-update-redirect@example.com",
      });

      await fixture.db.insert(integrationConnections).values({
        id: "icn_oauth_update_001",
        organizationId: authenticatedSession.organizationId,
        targetKey,
        displayName: "SigNoz Hosted",
        status: IntegrationConnectionStatuses.ACTIVE,
        externalSubjectId: "oauth-subject-001",
        config: {
          connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
          client_id: "signoz-client-id",
          region: "us",
        },
        createdAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:00:00.000Z",
      });

      const response = await app.request("/v1/integration/connections/icn_oauth_update_001", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify(
          UpdateIntegrationConnectionBodySchema.parse({
            displayName: "SigNoz EU",
            config: {
              region: "eu",
            },
          }),
        ),
      });

      expect(response.status).toBe(200);
      const updatedConnection = IntegrationConnectionSchema.parse(await response.json());
      expect(updatedConnection.displayName).toBe("SigNoz EU");
      expect(updatedConnection.config).toEqual({
        connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        client_id: "signoz-client-id",
        region: "eu",
      });

      const persistedConnection = await fixture.db.query.integrationConnections.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.id, "icn_oauth_update_001"),
            eq(table.organizationId, authenticatedSession.organizationId),
          ),
      });
      expect(persistedConnection?.config).toEqual({
        connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        client_id: "signoz-client-id",
        region: "eu",
      });
    } finally {
      await stopAppResources(resources);
    }
  });

  it("returns 400 when a target does not support OAuth 2.0 (Authorization Code) start", async ({
    fixture,
  }) => {
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-oauth2-start",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth2-authorization-code-start@example.com",
    });

    const response = await fixture.request(
      "/v1/integration/connections/openai-default-oauth2-start/oauth2-authorization-code/start",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      StartOAuth2AuthorizationCodeConnectionBadRequestResponseSchema.parse({
        code: "OAUTH2_NOT_SUPPORTED",
        message:
          "Integration target 'openai-default-oauth2-start' does not support OAuth 2.0 (Authorization Code).",
      }),
    );
  });

  it("returns a route error instead of auth middleware for OAuth 2.0 (Authorization Code) completion without a session", async ({
    fixture,
  }) => {
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-oauth2-complete",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });

    const response = await fixture.request(
      "/p/integration/callbacks/openai-default-oauth2-complete/oauth2-authorization-code?state=missing",
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      CompleteOAuth2AuthorizationCodeConnectionBadRequestResponseSchema.parse({
        code: "OAUTH2_NOT_SUPPORTED",
        message:
          "Integration target 'openai-default-oauth2-complete' does not support OAuth 2.0 (Authorization Code).",
      }),
    );
  });

  it("starts an OAuth 2.0 (Authorization Code) connection and persists encrypted provider state", async ({
    fixture,
  }) => {
    const targetKey = "oauth2-auth-code-provider-state-start";
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth2-authorization-code-provider-state-start@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: OAuth2AuthorizationCodeTestFamilyId,
      variantId: OAuth2AuthorizationCodeTestVariantId,
      enabled: true,
      config: {},
    });

    const registry = createOAuth2AuthorizationCodeTestRegistry({
      startAuthorization: async (input) => ({
        authorizationUrl: `https://auth.example.com/authorize?state=${encodeURIComponent(input.state)}`,
        providerState: {
          client_id: "client_123",
          client_secret: "secret_456",
        },
      }),
      completeAuthorizationCodeGrant: async () => {
        throw new Error("Not used in OAuth 2.0 (Authorization Code) start test.");
      },
    });

    const { app, resources } = await createOAuth2AuthorizationCodeTestApp({
      fixture,
      registry,
    });

    try {
      const response = await app.request(
        `/v1/integration/connections/${targetKey}/oauth2-authorization-code/start`,
        {
          method: "POST",
          headers: {
            cookie: authenticatedSession.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            displayName: "PlanetScale Hosted MCP",
          }),
        },
      );

      expect(response.status).toBe(200);
      const startedConnectionBody = await response.json();
      expect(startedConnectionBody).toEqual({
        authorizationUrl: expect.any(String),
      });
      const startedConnection =
        StartOAuth2AuthorizationCodeConnectionResponseSchema.parse(startedConnectionBody);
      const state = new URL(startedConnection.authorizationUrl).searchParams.get("state");
      if (state === null || state.length === 0) {
        throw new Error("Expected authorization URL to include redirect state.");
      }

      const redirectSession =
        await resources.db.query.integrationConnectionRedirectSessions.findFirst({
          where: (table, { eq }) => eq(table.state, state),
        });

      expect(redirectSession?.organizationId).toBe(authenticatedSession.organizationId);
      expect(redirectSession?.targetKey).toBe(targetKey);
      expect(redirectSession?.pkceVerifierEncrypted).toBeTruthy();
      expect(redirectSession?.providerStateEncrypted).toBeTruthy();
      expect(redirectSession?.providerStateEncrypted).not.toContain("client_123");
      expect(redirectSession?.providerStateEncrypted).not.toContain("secret_456");

      const decryptedProviderState = decryptRedirectProviderState({
        ciphertext: redirectSession?.providerStateEncrypted ?? "",
        masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
      });

      expect(decryptedProviderState).toEqual({
        client_id: "client_123",
        client_secret: "secret_456",
      });
    } finally {
      await stopAppResources(resources);
    }
  });

  it("passes validated redirect connection config into OAuth 2.0 start authorization", async ({
    fixture,
  }) => {
    const targetKey = "oauth2-auth-code-start-config";
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth2-authorization-code-start-config@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: OAuth2AuthorizationCodeTestFamilyId,
      variantId: OAuth2AuthorizationCodeTestVariantId,
      enabled: true,
      config: {},
    });

    let startedConnectionConfig: Record<string, unknown> | undefined;
    const registry = createOAuth2AuthorizationCodeTestRegistry({
      startConfigSchema: OAuth2AuthorizationCodeTestConnectionConfigSchema,
      startAuthorization: async (input) => {
        startedConnectionConfig = input.connectionConfig;

        return {
          authorizationUrl: `https://auth.example.com/authorize?state=${encodeURIComponent(input.state)}`,
        };
      },
      completeAuthorizationCodeGrant: async () => {
        throw new Error("Not used in OAuth 2.0 (Authorization Code) start test.");
      },
    });

    const { app, resources } = await createOAuth2AuthorizationCodeTestApp({
      fixture,
      registry,
    });

    try {
      const response = await app.request(
        `/v1/integration/connections/${targetKey}/oauth2-authorization-code/start`,
        {
          method: "POST",
          headers: {
            cookie: authenticatedSession.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            config: {
              region: "us",
            },
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(startedConnectionConfig).toEqual({
        region: "us",
      });
    } finally {
      await stopAppResources(resources);
    }
  });

  it("returns 400 when OAuth 2.0 start config is invalid", async ({ fixture }) => {
    const targetKey = "oauth2-auth-code-start-config-invalid";
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth2-authorization-code-start-config-invalid@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: OAuth2AuthorizationCodeTestFamilyId,
      variantId: OAuth2AuthorizationCodeTestVariantId,
      enabled: true,
      config: {},
    });

    const registry = createOAuth2AuthorizationCodeTestRegistry({
      startConfigSchema: OAuth2AuthorizationCodeTestConnectionConfigSchema,
      startAuthorization: async () => ({
        authorizationUrl: "https://auth.example.com/authorize",
      }),
      completeAuthorizationCodeGrant: async () => {
        throw new Error("Not used in OAuth 2.0 (Authorization Code) start test.");
      },
    });

    const { app, resources } = await createOAuth2AuthorizationCodeTestApp({
      fixture,
      registry,
    });

    try {
      const response = await app.request(
        `/v1/integration/connections/${targetKey}/oauth2-authorization-code/start`,
        {
          method: "POST",
          headers: {
            cookie: authenticatedSession.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            config: {},
          }),
        },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual(
        StartOAuth2AuthorizationCodeConnectionBadRequestResponseSchema.parse({
          code: "INVALID_OAUTH2_START_INPUT",
          message: `Integration target '${targetKey}' received invalid OAuth 2.0 (Authorization Code) connection config.`,
        }),
      );
    } finally {
      await stopAppResources(resources);
    }
  });

  it("completes an OAuth 2.0 (Authorization Code) connection with decrypted provider state", async ({
    fixture,
  }) => {
    const targetKey = "oauth2-auth-code-provider-state-complete";
    const authenticatedSession = await fixture.authSession({
      email:
        "integration-connections-oauth2-authorization-code-provider-state-complete@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: OAuth2AuthorizationCodeTestFamilyId,
      variantId: OAuth2AuthorizationCodeTestVariantId,
      enabled: true,
      config: {},
    });

    let completedProviderState: Record<string, unknown> | undefined;
    let completedPkceVerifier: string | undefined;
    const registry = createOAuth2AuthorizationCodeTestRegistry({
      startAuthorization: async (input) => ({
        authorizationUrl: `https://auth.example.com/authorize?state=${encodeURIComponent(input.state)}`,
        providerState: {
          client_id: "client_complete_123",
          client_secret: "secret_complete_456",
        },
      }),
      completeAuthorizationCodeGrant: async (input) => {
        completedProviderState = input.providerState;
        completedPkceVerifier = input.pkceVerifier;

        return {
          connectionConfig: {
            account_id: "acct_123",
          },
          accessToken: "access-token-123",
        };
      },
    });

    const { app, resources } = await createOAuth2AuthorizationCodeTestApp({
      fixture,
      registry,
    });

    try {
      const startResponse = await app.request(
        `/v1/integration/connections/${targetKey}/oauth2-authorization-code/start`,
        {
          method: "POST",
          headers: {
            cookie: authenticatedSession.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      expect(startResponse.status).toBe(200);
      const startedConnection = StartOAuth2AuthorizationCodeConnectionResponseSchema.parse(
        await startResponse.json(),
      );
      const state = new URL(startedConnection.authorizationUrl).searchParams.get("state");
      if (state === null || state.length === 0) {
        throw new Error("Expected authorization URL to include redirect state.");
      }

      const completeResponse = await app.request(
        `/p/integration/callbacks/${targetKey}/oauth2-authorization-code?state=${encodeURIComponent(state)}&code=code_123`,
        {
          method: "GET",
          redirect: "manual",
        },
      );

      expect(completeResponse.status).toBe(302);
      expect(completeResponse.headers.get("location")).toBe(
        `http://localhost:5173/integrations/${encodeURIComponent(targetKey)}`,
      );
      expect(completedProviderState).toEqual({
        client_id: "client_complete_123",
        client_secret: "secret_complete_456",
      });
      expect(typeof completedPkceVerifier).toBe("string");
      expect(completedPkceVerifier?.length).toBeGreaterThan(0);

      const createdConnection = await resources.db.query.integrationConnections.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, authenticatedSession.organizationId),
            eq(table.targetKey, targetKey),
          ),
      });
      expect(createdConnection?.displayName).toBe(targetKey);
      expect(createdConnection?.status).toBe("active");
      expect(createdConnection?.config).toMatchObject({
        connection_method: "oauth2-authorization-code",
        account_id: "acct_123",
      });

      const redirectSession =
        await resources.db.query.integrationConnectionRedirectSessions.findFirst({
          where: (table, { eq }) => eq(table.state, state),
        });
      expect(redirectSession?.usedAt).toBeTruthy();
    } finally {
      await stopAppResources(resources);
    }
  });

  it("persists an optional OAuth 2.0 client secret returned during completion", async ({
    fixture,
  }) => {
    const targetKey = "oauth2-auth-code-client-secret-complete";
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth2-authorization-code-client-secret-complete@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: OAuth2AuthorizationCodeTestFamilyId,
      variantId: OAuth2AuthorizationCodeTestVariantId,
      enabled: true,
      config: {},
    });

    const registry = createOAuth2AuthorizationCodeTestRegistry({
      startAuthorization: async (input) => ({
        authorizationUrl: `https://auth.example.com/authorize?state=${encodeURIComponent(input.state)}`,
      }),
      completeAuthorizationCodeGrant: async () => ({
        connectionConfig: {
          account_id: "acct_client_secret_123",
        },
        accessToken: "access-token-client-secret-123",
        clientSecret: "oauth-client-secret-123",
      }),
    });

    const { app, resources } = await createOAuth2AuthorizationCodeTestApp({
      fixture,
      registry,
    });

    try {
      const startResponse = await app.request(
        `/v1/integration/connections/${targetKey}/oauth2-authorization-code/start`,
        {
          method: "POST",
          headers: {
            cookie: authenticatedSession.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      expect(startResponse.status).toBe(200);
      const startedConnection = StartOAuth2AuthorizationCodeConnectionResponseSchema.parse(
        await startResponse.json(),
      );
      const state = new URL(startedConnection.authorizationUrl).searchParams.get("state");
      if (state === null || state.length === 0) {
        throw new Error("Expected authorization URL to include redirect state.");
      }

      const completeResponse = await app.request(
        `/p/integration/callbacks/${targetKey}/oauth2-authorization-code?state=${encodeURIComponent(state)}&code=code_client_secret_123`,
        {
          method: "GET",
          redirect: "manual",
        },
      );

      expect(completeResponse.status).toBe(302);

      const createdConnection = await resources.db.query.integrationConnections.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, authenticatedSession.organizationId),
            eq(table.targetKey, targetKey),
          ),
      });
      if (createdConnection === undefined) {
        throw new Error("Expected completed OAuth 2.0 connection.");
      }

      const linkedCredentials = await resources.db.query.integrationConnectionCredentials.findMany({
        where: (table, { eq }) => eq(table.connectionId, createdConnection.id),
      });
      expect(linkedCredentials).toHaveLength(2);

      const credentialIds = linkedCredentials.map((link) => link.credentialId);
      const storedCredentials = await resources.db.query.integrationCredentials.findMany({
        where: (table, { inArray }) => inArray(table.id, credentialIds),
      });

      const clientSecretCredential = storedCredentials.find(
        (credential) =>
          credential.secretKind === IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
      );
      if (clientSecretCredential === undefined) {
        throw new Error("Expected OAuth 2.0 client secret credential to be stored.");
      }

      const organizationCredentialKey =
        await resources.db.query.organizationCredentialKeys.findFirst({
          where: (table, { eq }) => eq(table.organizationId, authenticatedSession.organizationId),
          orderBy: (table, { desc }) => [desc(table.version)],
        });
      if (organizationCredentialKey === undefined) {
        throw new Error("Expected organization credential key.");
      }

      expect(
        decryptStoredCredential({
          wrappedOrganizationKeyCiphertext: organizationCredentialKey.ciphertext,
          masterKeyVersion: organizationCredentialKey.masterKeyVersion,
          masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
          nonce: clientSecretCredential.nonce,
          ciphertext: clientSecretCredential.ciphertext,
        }),
      ).toBe("oauth-client-secret-123");
    } finally {
      await stopAppResources(resources);
    }
  });

  it("keeps existing OAuth 2.0 (Authorization Code) flows working when provider state is omitted", async ({
    fixture,
  }) => {
    const targetKey = "oauth2-auth-code-provider-state-omitted";
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth2-authorization-code-provider-state-omitted@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: OAuth2AuthorizationCodeTestFamilyId,
      variantId: OAuth2AuthorizationCodeTestVariantId,
      enabled: true,
      config: {},
    });

    let completedProviderState: Record<string, unknown> | undefined;
    const registry = createOAuth2AuthorizationCodeTestRegistry({
      startAuthorization: async (input) => ({
        authorizationUrl: `https://auth.example.com/authorize?state=${encodeURIComponent(input.state)}`,
      }),
      completeAuthorizationCodeGrant: async (input) => {
        completedProviderState = input.providerState;

        return {
          connectionConfig: {
            account_id: "acct_omit_123",
          },
          accessToken: "access-token-omit-123",
        };
      },
    });

    const { app, resources } = await createOAuth2AuthorizationCodeTestApp({
      fixture,
      registry,
    });

    try {
      const startResponse = await app.request(
        `/v1/integration/connections/${targetKey}/oauth2-authorization-code/start`,
        {
          method: "POST",
          headers: {
            cookie: authenticatedSession.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      expect(startResponse.status).toBe(200);
      const startedConnection = StartOAuth2AuthorizationCodeConnectionResponseSchema.parse(
        await startResponse.json(),
      );
      const state = new URL(startedConnection.authorizationUrl).searchParams.get("state");
      if (state === null || state.length === 0) {
        throw new Error("Expected authorization URL to include redirect state.");
      }

      const redirectSession =
        await resources.db.query.integrationConnectionRedirectSessions.findFirst({
          where: (table, { eq }) => eq(table.state, state),
        });
      expect(redirectSession?.providerStateEncrypted).toBeNull();

      const completeResponse = await app.request(
        `/p/integration/callbacks/${targetKey}/oauth2-authorization-code?state=${encodeURIComponent(state)}&code=code_omit_123`,
        {
          method: "GET",
          redirect: "manual",
        },
      );

      expect(completeResponse.status).toBe(302);
      expect(completedProviderState).toBeUndefined();

      const createdConnection = await resources.db.query.integrationConnections.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, authenticatedSession.organizationId),
            eq(table.targetKey, targetKey),
          ),
      });
      expect(createdConnection?.config).toMatchObject({
        connection_method: "oauth2-authorization-code",
        account_id: "acct_omit_123",
      });
    } finally {
      await stopAppResources(resources);
    }
  });
});
