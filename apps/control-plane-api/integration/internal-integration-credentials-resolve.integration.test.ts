import { generateKeyPairSync } from "node:crypto";

import {
  IntegrationBindingKinds,
  integrationConnectionCredentials,
  IntegrationConnectionStatuses,
  integrationConnections,
  IntegrationCredentialSecretKinds,
  integrationCredentials,
  integrationTargets,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationRegistry,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  CONTROL_PLANE_INTERNAL_AUTH_HEADER,
  INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH,
} from "../src/internal/integration-credentials/index.js";
import { InternalIntegrationCredentialsErrorCodes } from "../src/internal/integration-credentials/services/errors.js";
import { resolveIntegrationCredential } from "../src/internal/integration-credentials/services/resolve-credential.js";
import {
  decryptCredentialUtf8,
  encryptCredentialUtf8,
  encryptIntegrationTargetSecrets,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../src/lib/crypto.js";
import { it } from "./test-context.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";

type ConnectionResponse = {
  id: string;
};

const EmptyConfigSchema = z.object({});
const ClientCredentialsConnectionMethodId = "oauth2-client-credentials-test";
const ClientCredentialsClientSecretSlotKey =
  "oauth2.client-credentials-test.oauth2-client-credentials-test.client-secret";
const ClientCredentialsAccessTokenSlotKey =
  "oauth2.client-credentials-test.oauth2-client-credentials-test.access-token";
const DeviceAuthorizationRefreshFamilyId = "device-auth";
const DeviceAuthorizationRefreshVariantId = "refresh-test";
const DeviceAuthorizationRefreshConnectionMethodId = "chatgpt-device-code";
const DeviceAuthorizationRefreshSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: DeviceAuthorizationRefreshFamilyId,
  variantId: DeviceAuthorizationRefreshVariantId,
});

function createClientCredentialsRegistry(): IntegrationRegistry {
  const registry = new IntegrationRegistry();
  const definition: IntegrationDefinition<
    typeof EmptyConfigSchema,
    typeof EmptyConfigSchema,
    typeof EmptyConfigSchema
  > = {
    familyId: "oauth2",
    variantId: "client-credentials-test",
    kind: "connector",
    displayName: "OAuth2 Client Credentials Test",
    logoKey: "oauth2",
    targetConfigSchema: EmptyConfigSchema,
    targetSecretSchema: EmptyConfigSchema,
    bindingConfigSchema: EmptyConfigSchema,
    connectionMethods: [
      {
        id: ClientCredentialsConnectionMethodId,
        label: "OAuth2 client credentials",
        kind: "form",
        secretFields: [
          {
            name: "clientSecret",
            label: "Client secret",
            inputType: "password",
            secretType: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
            slotKey: ClientCredentialsClientSecretSlotKey,
          },
        ],
        configSchema: z
          .object({
            connection_method: z.literal(ClientCredentialsConnectionMethodId),
          })
          .strict(),
      },
    ],
    oauth2ClientCredentials: {
      exchangeClientCredentials: async (input) => ({
        accessToken: `access-token-for:${input.clientSecret}`,
        accessTokenExpiresAt: "2030-01-01T00:00:00.000Z",
      }),
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

function createDeviceAuthorizationRefreshRegistry(input: {
  refreshAccessToken: NonNullable<
    IntegrationDefinition<
      typeof EmptyConfigSchema,
      typeof EmptyConfigSchema,
      typeof EmptyConfigSchema,
      {
        connection_method: "chatgpt-device-code";
        auth_mode: "chatgpt";
        chatgpt_account_id: string;
      }
    >["oauth2AuthorizationCode"]
  >["refreshAccessToken"];
}): IntegrationRegistry {
  const registry = new IntegrationRegistry();
  const definition: IntegrationDefinition<
    typeof EmptyConfigSchema,
    typeof EmptyConfigSchema,
    typeof EmptyConfigSchema,
    {
      connection_method: "chatgpt-device-code";
      auth_mode: "chatgpt";
      chatgpt_account_id: string;
    }
  > = {
    familyId: DeviceAuthorizationRefreshFamilyId,
    variantId: DeviceAuthorizationRefreshVariantId,
    kind: "agent",
    displayName: "Device Authorization Refresh Test",
    logoKey: "openai",
    targetConfigSchema: EmptyConfigSchema,
    targetSecretSchema: EmptyConfigSchema,
    bindingConfigSchema: EmptyConfigSchema,
    connectionMethods: [
      {
        id: DeviceAuthorizationRefreshConnectionMethodId,
        label: "ChatGPT subscription",
        kind: "device-authorization",
        ui: {
          create: {
            submitLabel: "Connect",
            helperText: "Connect with device authorization",
          },
        },
      },
    ],
    deviceAuthorization: {
      startDeviceAuthorization: async () => {
        throw new Error("Not used in internal credential refresh tests.");
      },
      pollDeviceAuthorization: async () => {
        throw new Error("Not used in internal credential refresh tests.");
      },
    },
    oauth2AuthorizationCode: {
      startAuthorization: async () => {
        throw new Error("Not used in internal credential refresh tests.");
      },
      completeAuthorizationCodeGrant: async () => {
        throw new Error("Not used in internal credential refresh tests.");
      },
      refreshAccessToken: input.refreshAccessToken,
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

async function insertGitHubBindingFixture(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  targetKey: string;
  bindingId: string;
}) {
  const authSession = await input.fixture.authSession();
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
  });
  await input.fixture.db.insert(integrationTargets).values({
    targetKey: input.targetKey,
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
  const createConnectionResponse = await input.fixture.request(
    `/v1/integration/connections/${input.targetKey}/form`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authSession.cookie,
      },
      body: JSON.stringify({
        displayName: "GitHub binding-aware connection",
        methodId: "github-app-installation",
        config: {
          connection_method: "github-app-installation",
          app_id: "123",
          app_slug: "mistle-github-app",
          installation_id: "12345",
        },
        secrets: {
          appPrivateKeyPem: privateKey,
          webhookSecret: "github-webhook-secret",
        },
      }),
    },
  );
  expect(createConnectionResponse.status).toBe(201);
  const connection = (await createConnectionResponse.json()) as ConnectionResponse;

  await input.fixture.db.insert(sandboxProfiles).values({
    id: "sbp_github_binding_aware",
    organizationId: authSession.organizationId,
    displayName: "GitHub binding-aware profile",
  });

  await input.fixture.db.insert(sandboxProfileVersions).values({
    sandboxProfileId: "sbp_github_binding_aware",
    version: 1,
  });

  await input.fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
    id: input.bindingId,
    sandboxProfileId: "sbp_github_binding_aware",
    sandboxProfileVersion: 1,
    connectionId: connection.id,
    kind: IntegrationBindingKinds.GIT,
    config: {
      repositories: ["mistlehq/mistle", "mistlehq/platform", "mistlehq/mistle"],
    },
  });

  return {
    organizationId: authSession.organizationId,
    connectionId: connection.id,
    bindingId: input.bindingId,
  };
}

describe("internal integration credentials resolve", () => {
  it("resolves persisted integration credentials for an active connection", async ({ fixture }) => {
    const authSession = await fixture.authSession();

    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai_default",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        base_url: "https://api.openai.com/v1",
      },
    });

    const createConnectionResponse = await fixture.request(
      "/v1/integration/connections/openai_default/form",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authSession.cookie,
        },
        body: JSON.stringify({
          displayName: "OpenAI internal credential test",
          methodId: "api-key",
          config: {
            connection_method: "api-key",
          },
          secrets: {
            apiKey: "sk-integration-test",
          },
        }),
      },
    );
    expect(createConnectionResponse.status).toBe(201);
    const connection = (await createConnectionResponse.json()) as ConnectionResponse;

    const resolveResponse = await fixture.request(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          connectionId: connection.id,
          secretType: "api_key",
          slotKey: "openai.openai-default.api-key.api-key",
        }),
      },
    );

    expect(resolveResponse.status).toBe(200);
    await expect(resolveResponse.json()).resolves.toEqual({
      value: "sk-integration-test",
    });
  });

  it("resolves persisted OAuth2 access tokens with structural expiry", async ({ fixture }) => {
    const authSession = await fixture.authSession();
    const oauth2AuthorizationCodeSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
      familyId: "openai",
      variantId: "openai-default",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai_oauth2_default",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });

    await fixture.db.insert(integrationConnections).values({
      id: "icn_oauth2_access",
      organizationId: authSession.organizationId,
      targetKey: "openai_oauth2_default",
      displayName: "Stored OAuth2 token",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "oauth2-authorization-code",
      },
    });

    const organizationCredentialKey = await fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, authSession.organizationId),
      orderBy: (table, { desc }) => [desc(table.version)],
    });
    if (organizationCredentialKey === undefined) {
      throw new Error("Expected organization credential key.");
    }

    const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
      masterKeyVersion: organizationCredentialKey.masterKeyVersion,
      masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
    });
    const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
      wrappedCiphertext: organizationCredentialKey.ciphertext,
      masterEncryptionKeyMaterial,
    });

    try {
      const encryptedAccessToken = encryptCredentialUtf8({
        plaintext: "oauth2-access-token-value",
        organizationCredentialKey: unwrappedOrganizationCredentialKey,
      });

      await fixture.db.insert(integrationCredentials).values({
        id: "icr_oauth2_access",
        organizationId: authSession.organizationId,
        secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
        ciphertext: encryptedAccessToken.ciphertext,
        nonce: encryptedAccessToken.nonce,
        organizationCredentialKeyVersion: organizationCredentialKey.version,
        intendedFamilyId: "openai",
        expiresAt: "2030-01-01T00:00:00.000Z",
      });
    } finally {
      unwrappedOrganizationCredentialKey.fill(0);
    }

    await fixture.db.insert(integrationConnectionCredentials).values({
      connectionId: "icn_oauth2_access",
      credentialId: "icr_oauth2_access",
      slotKey: oauth2AuthorizationCodeSlotKeys.accessToken,
    });

    const resolveResponse = await fixture.request(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          connectionId: "icn_oauth2_access",
          secretType: "oauth2_access_token",
          slotKey: oauth2AuthorizationCodeSlotKeys.accessToken,
        }),
      },
    );

    expect(resolveResponse.status).toBe(200);
    await expect(resolveResponse.json()).resolves.toEqual({
      value: "oauth2-access-token-value",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
  });

  it("refreshes expired device-authorization access tokens through the managed path", async ({
    fixture,
  }) => {
    const authSession = await fixture.authSession();

    await fixture.db.insert(integrationTargets).values({
      targetKey: "device_auth_refresh_target",
      familyId: DeviceAuthorizationRefreshFamilyId,
      variantId: DeviceAuthorizationRefreshVariantId,
      enabled: true,
      config: {},
    });

    await fixture.db.insert(integrationConnections).values({
      id: "icn_device_auth_refresh",
      organizationId: authSession.organizationId,
      targetKey: "device_auth_refresh_target",
      displayName: "Device auth refresh",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: DeviceAuthorizationRefreshConnectionMethodId,
        auth_mode: "chatgpt",
        chatgpt_account_id: "acct_123",
      },
    });

    const organizationCredentialKey = await fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, authSession.organizationId),
      orderBy: (table, { desc }) => [desc(table.version)],
    });
    if (organizationCredentialKey === undefined) {
      throw new Error("Expected organization credential key.");
    }

    const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
      masterKeyVersion: organizationCredentialKey.masterKeyVersion,
      masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
    });
    const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
      wrappedCiphertext: organizationCredentialKey.ciphertext,
      masterEncryptionKeyMaterial,
    });

    try {
      const encryptedExpiredAccessToken = encryptCredentialUtf8({
        plaintext: "expired-access-token",
        organizationCredentialKey: unwrappedOrganizationCredentialKey,
      });
      const encryptedRefreshToken = encryptCredentialUtf8({
        plaintext: "valid-refresh-token",
        organizationCredentialKey: unwrappedOrganizationCredentialKey,
      });

      await fixture.db.insert(integrationCredentials).values([
        {
          id: "icr_device_auth_access_old",
          organizationId: authSession.organizationId,
          secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
          ciphertext: encryptedExpiredAccessToken.ciphertext,
          nonce: encryptedExpiredAccessToken.nonce,
          organizationCredentialKeyVersion: organizationCredentialKey.version,
          intendedFamilyId: DeviceAuthorizationRefreshFamilyId,
          expiresAt: "2000-01-01T00:00:00.000Z",
        },
        {
          id: "icr_device_auth_refresh_old",
          organizationId: authSession.organizationId,
          secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
          ciphertext: encryptedRefreshToken.ciphertext,
          nonce: encryptedRefreshToken.nonce,
          organizationCredentialKeyVersion: organizationCredentialKey.version,
          intendedFamilyId: DeviceAuthorizationRefreshFamilyId,
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
      ]);
    } finally {
      unwrappedOrganizationCredentialKey.fill(0);
    }

    await fixture.db.insert(integrationConnectionCredentials).values([
      {
        connectionId: "icn_device_auth_refresh",
        credentialId: "icr_device_auth_access_old",
        slotKey: DeviceAuthorizationRefreshSlotKeys.accessToken,
      },
      {
        connectionId: "icn_device_auth_refresh",
        credentialId: "icr_device_auth_refresh_old",
        slotKey: DeviceAuthorizationRefreshSlotKeys.refreshToken,
      },
    ]);

    const integrationRegistry = createDeviceAuthorizationRefreshRegistry({
      refreshAccessToken: async (input) => {
        expect(input.refreshToken).toBe("valid-refresh-token");
        return {
          accessToken: "rotated-access-token",
          accessTokenExpiresAt: "2030-01-02T00:00:00.000Z",
          refreshToken: "rotated-refresh-token",
          refreshTokenExpiresAt: "2030-01-03T00:00:00.000Z",
          credentialMetadata: {
            provider: "openai",
          },
        };
      },
    });

    const resolvedCredential = await resolveIntegrationCredential(
      {
        db: fixture.db,
        integrationRegistry,
        integrationsConfig: fixture.config.integrations,
      },
      {
        connectionId: "icn_device_auth_refresh",
        secretType: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
        slotKey: DeviceAuthorizationRefreshSlotKeys.accessToken,
      },
    );

    expect(resolvedCredential).toEqual({
      value: "rotated-access-token",
      expiresAt: "2030-01-02T00:00:00.000Z",
    });

    const activeConnection = await fixture.db.query.integrationConnections.findFirst({
      where: (table, { eq }) => eq(table.id, "icn_device_auth_refresh"),
    });
    expect(activeConnection?.status).toBe(IntegrationConnectionStatuses.ACTIVE);

    const accessCredentialLink = await fixture.db.query.integrationConnectionCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.connectionId, "icn_device_auth_refresh"),
          eq(table.slotKey, DeviceAuthorizationRefreshSlotKeys.accessToken),
        ),
    });
    const refreshCredentialLink = await fixture.db.query.integrationConnectionCredentials.findFirst(
      {
        where: (table, { and, eq }) =>
          and(
            eq(table.connectionId, "icn_device_auth_refresh"),
            eq(table.slotKey, DeviceAuthorizationRefreshSlotKeys.refreshToken),
          ),
      },
    );

    if (accessCredentialLink === undefined || refreshCredentialLink === undefined) {
      throw new Error("Expected refreshed credential links.");
    }

    expect(accessCredentialLink.credentialId).not.toBe("icr_device_auth_access_old");
    expect(refreshCredentialLink.credentialId).not.toBe("icr_device_auth_refresh_old");

    const activeAccessCredential = await fixture.db.query.integrationCredentials.findFirst({
      where: (table, { eq }) => eq(table.id, accessCredentialLink.credentialId),
    });
    const activeRefreshCredential = await fixture.db.query.integrationCredentials.findFirst({
      where: (table, { eq }) => eq(table.id, refreshCredentialLink.credentialId),
    });
    const revokedAccessCredential = await fixture.db.query.integrationCredentials.findFirst({
      where: (table, { eq }) => eq(table.id, "icr_device_auth_access_old"),
    });
    const revokedRefreshCredential = await fixture.db.query.integrationCredentials.findFirst({
      where: (table, { eq }) => eq(table.id, "icr_device_auth_refresh_old"),
    });

    if (activeAccessCredential === undefined || activeRefreshCredential === undefined) {
      throw new Error("Expected active refreshed credentials.");
    }

    expect(revokedAccessCredential?.revokedAt).not.toBeNull();
    expect(revokedRefreshCredential?.revokedAt).not.toBeNull();
    expect(activeAccessCredential.secretKind).toBe(
      IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
    );
    expect(activeRefreshCredential.secretKind).toBe(
      IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
    );

    expect(
      decryptStoredCredential({
        wrappedOrganizationKeyCiphertext: organizationCredentialKey.ciphertext,
        masterKeyVersion: organizationCredentialKey.masterKeyVersion,
        masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
        nonce: activeAccessCredential.nonce,
        ciphertext: activeAccessCredential.ciphertext,
      }),
    ).toBe("rotated-access-token");
    expect(
      decryptStoredCredential({
        wrappedOrganizationKeyCiphertext: organizationCredentialKey.ciphertext,
        masterKeyVersion: organizationCredentialKey.masterKeyVersion,
        masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
        nonce: activeRefreshCredential.nonce,
        ciphertext: activeRefreshCredential.ciphertext,
      }),
    ).toBe("rotated-refresh-token");
  });

  it("marks the connection errored when device-authorization refresh fails permanently", async ({
    fixture,
  }) => {
    const authSession = await fixture.authSession();

    await fixture.db.insert(integrationTargets).values({
      targetKey: "device_auth_refresh_failure_target",
      familyId: DeviceAuthorizationRefreshFamilyId,
      variantId: DeviceAuthorizationRefreshVariantId,
      enabled: true,
      config: {},
    });

    await fixture.db.insert(integrationConnections).values({
      id: "icn_device_auth_refresh_failure",
      organizationId: authSession.organizationId,
      targetKey: "device_auth_refresh_failure_target",
      displayName: "Device auth refresh failure",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: DeviceAuthorizationRefreshConnectionMethodId,
        auth_mode: "chatgpt",
        chatgpt_account_id: "acct_456",
      },
    });

    const organizationCredentialKey = await fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, authSession.organizationId),
      orderBy: (table, { desc }) => [desc(table.version)],
    });
    if (organizationCredentialKey === undefined) {
      throw new Error("Expected organization credential key.");
    }

    const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
      masterKeyVersion: organizationCredentialKey.masterKeyVersion,
      masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
    });
    const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
      wrappedCiphertext: organizationCredentialKey.ciphertext,
      masterEncryptionKeyMaterial,
    });

    try {
      const encryptedExpiredAccessToken = encryptCredentialUtf8({
        plaintext: "expired-access-token",
        organizationCredentialKey: unwrappedOrganizationCredentialKey,
      });
      const encryptedRefreshToken = encryptCredentialUtf8({
        plaintext: "revoked-refresh-token",
        organizationCredentialKey: unwrappedOrganizationCredentialKey,
      });

      await fixture.db.insert(integrationCredentials).values([
        {
          id: "icr_device_auth_access_failure_old",
          organizationId: authSession.organizationId,
          secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
          ciphertext: encryptedExpiredAccessToken.ciphertext,
          nonce: encryptedExpiredAccessToken.nonce,
          organizationCredentialKeyVersion: organizationCredentialKey.version,
          intendedFamilyId: DeviceAuthorizationRefreshFamilyId,
          expiresAt: "2000-01-01T00:00:00.000Z",
        },
        {
          id: "icr_device_auth_refresh_failure_old",
          organizationId: authSession.organizationId,
          secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
          ciphertext: encryptedRefreshToken.ciphertext,
          nonce: encryptedRefreshToken.nonce,
          organizationCredentialKeyVersion: organizationCredentialKey.version,
          intendedFamilyId: DeviceAuthorizationRefreshFamilyId,
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
      ]);
    } finally {
      unwrappedOrganizationCredentialKey.fill(0);
    }

    await fixture.db.insert(integrationConnectionCredentials).values([
      {
        connectionId: "icn_device_auth_refresh_failure",
        credentialId: "icr_device_auth_access_failure_old",
        slotKey: DeviceAuthorizationRefreshSlotKeys.accessToken,
      },
      {
        connectionId: "icn_device_auth_refresh_failure",
        credentialId: "icr_device_auth_refresh_failure_old",
        slotKey: DeviceAuthorizationRefreshSlotKeys.refreshToken,
      },
    ]);

    const integrationRegistry = createDeviceAuthorizationRefreshRegistry({
      refreshAccessToken: async () => {
        throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
          message: "refresh token expired",
          classification:
            IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
          code: "refresh_token_expired",
        });
      },
    });

    await expect(
      resolveIntegrationCredential(
        {
          db: fixture.db,
          integrationRegistry,
          integrationsConfig: fixture.config.integrations,
        },
        {
          connectionId: "icn_device_auth_refresh_failure",
          secretType: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
          slotKey: DeviceAuthorizationRefreshSlotKeys.accessToken,
        },
      ),
    ).rejects.toMatchObject({
      code: InternalIntegrationCredentialsErrorCodes.OAUTH2_REFRESH_FAILED,
      status: 400,
      message: "refresh token expired",
    });

    const erroredConnection = await fixture.db.query.integrationConnections.findFirst({
      where: (table, { eq }) => eq(table.id, "icn_device_auth_refresh_failure"),
    });
    expect(erroredConnection?.status).toBe(IntegrationConnectionStatuses.ERROR);
  });

  it("mints and reuses OAuth2 client-credentials access tokens", async ({ fixture }) => {
    const authSession = await fixture.authSession();

    await fixture.db.insert(integrationTargets).values({
      targetKey: "oauth2_client_credentials_target",
      familyId: "oauth2",
      variantId: "client-credentials-test",
      enabled: true,
      config: {},
    });

    await fixture.db.insert(integrationConnections).values({
      id: "icn_oauth2_client_credentials",
      organizationId: authSession.organizationId,
      targetKey: "oauth2_client_credentials_target",
      displayName: "OAuth2 client credentials connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: ClientCredentialsConnectionMethodId,
      },
    });

    const organizationCredentialKey = await fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, authSession.organizationId),
      orderBy: (table, { desc }) => [desc(table.version)],
    });
    if (organizationCredentialKey === undefined) {
      throw new Error("Expected organization credential key.");
    }

    const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
      masterKeyVersion: organizationCredentialKey.masterKeyVersion,
      masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
    });
    const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
      wrappedCiphertext: organizationCredentialKey.ciphertext,
      masterEncryptionKeyMaterial,
    });

    try {
      const encryptedClientSecret = encryptCredentialUtf8({
        plaintext: "client-secret-value",
        organizationCredentialKey: unwrappedOrganizationCredentialKey,
      });

      await fixture.db.insert(integrationCredentials).values({
        id: "icr_oauth2_client_secret",
        organizationId: authSession.organizationId,
        secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
        ciphertext: encryptedClientSecret.ciphertext,
        nonce: encryptedClientSecret.nonce,
        organizationCredentialKeyVersion: organizationCredentialKey.version,
        intendedFamilyId: "oauth2",
      });
    } finally {
      unwrappedOrganizationCredentialKey.fill(0);
    }

    await fixture.db.insert(integrationConnectionCredentials).values({
      connectionId: "icn_oauth2_client_credentials",
      credentialId: "icr_oauth2_client_secret",
      slotKey: ClientCredentialsClientSecretSlotKey,
    });

    const integrationRegistry = createClientCredentialsRegistry();

    const firstResolution = await resolveIntegrationCredential(
      {
        db: fixture.db,
        integrationRegistry,
        integrationsConfig: fixture.config.integrations,
      },
      {
        connectionId: "icn_oauth2_client_credentials",
        secretType: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
        slotKey: ClientCredentialsAccessTokenSlotKey,
      },
    );

    expect(firstResolution).toEqual({
      value: "access-token-for:client-secret-value",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });

    const accessCredentialsAfterFirstResolution =
      await fixture.db.query.integrationCredentials.findMany({
        columns: {
          id: true,
          secretKind: true,
          revokedAt: true,
        },
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, authSession.organizationId),
            eq(table.secretKind, IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN),
          ),
      });

    expect(accessCredentialsAfterFirstResolution).toHaveLength(1);
    const firstAccessCredential = accessCredentialsAfterFirstResolution[0];
    if (firstAccessCredential === undefined) {
      throw new Error("Expected one stored access token credential.");
    }
    expect(firstAccessCredential.secretKind).toBe(
      IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
    );
    expect(firstAccessCredential.revokedAt).toBeNull();

    const secondResolution = await resolveIntegrationCredential(
      {
        db: fixture.db,
        integrationRegistry,
        integrationsConfig: fixture.config.integrations,
      },
      {
        connectionId: "icn_oauth2_client_credentials",
        secretType: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
        slotKey: ClientCredentialsAccessTokenSlotKey,
      },
    );

    expect(secondResolution).toEqual(firstResolution);

    const accessCredentialsAfterSecondResolution =
      await fixture.db.query.integrationCredentials.findMany({
        columns: {
          id: true,
        },
        where: (table, { and, eq, isNull }) =>
          and(
            eq(table.organizationId, authSession.organizationId),
            eq(table.secretKind, IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN),
            isNull(table.revokedAt),
          ),
      });

    expect(accessCredentialsAfterSecondResolution).toHaveLength(1);

    const linkedAccessCredential =
      await fixture.db.query.integrationConnectionCredentials.findFirst({
        columns: {
          credentialId: true,
        },
        where: (table, { and, eq }) =>
          and(
            eq(table.connectionId, "icn_oauth2_client_credentials"),
            eq(table.slotKey, ClientCredentialsAccessTokenSlotKey),
          ),
      });

    const activeAccessCredential = accessCredentialsAfterSecondResolution[0];
    if (activeAccessCredential === undefined) {
      throw new Error("Expected one active access token credential.");
    }
    expect(linkedAccessCredential).toEqual({
      credentialId: activeAccessCredential.id,
    });
  });

  it("rejects requests with invalid internal service token", async ({ fixture }) => {
    const response = await fixture.request(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: "invalid-service-token",
        },
        body: JSON.stringify({
          connectionId: "icn_missing",
          secretType: "api_key",
        }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("rejects requests without internal service token", async ({ fixture }) => {
    const response = await fixture.request(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          connectionId: "icn_missing",
          secretType: "api_key",
        }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("resolves encrypted integration target secrets", async ({ fixture }) => {
    const encryptedSecrets = encryptIntegrationTargetSecrets({
      secrets: {
        webhook_secret: "super-secret",
        app_private_key: "private-key",
      },
      masterKeyVersion: 1,
      masterEncryptionKeyMaterial: "integration-master-key-testing",
    });

    const response = await fixture.request(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve-target-secrets`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          targets: [
            {
              targetKey: "github-cloud",
              encryptedSecrets,
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      targets: [
        {
          targetKey: "github-cloud",
          secrets: {
            webhook_secret: "super-secret",
            app_private_key: "private-key",
          },
        },
      ],
    });
  });

  it("rejects malformed encrypted integration target secrets", async ({ fixture }) => {
    const response = await fixture.request(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve-target-secrets`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          targets: [
            {
              targetKey: "github-cloud",
              encryptedSecrets: {
                masterKeyVersion: 1,
                nonce: "broken",
                ciphertext: "broken",
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_TARGET_SECRETS",
      message: "Target 'github-cloud' has invalid encrypted target secrets.",
    });
  });

  it("rejects custom credential resolution when binding belongs to a different connection", async ({
    fixture,
  }) => {
    const githubFixture = await insertGitHubBindingFixture({
      fixture,
      targetKey: "github-cloud-binding-aware-mismatch",
      bindingId: "ibd_github_binding_aware_mismatch",
    });

    await fixture.db.insert(integrationConnections).values({
      id: "icn_github_other_connection",
      organizationId: githubFixture.organizationId,
      targetKey: "github-cloud-binding-aware-mismatch",
      displayName: "Other GitHub connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "github-app-installation",
        app_id: "123",
        app_slug: "mistle-github-app",
        installation_id: "67890",
      },
    });

    const response = await fixture.request(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          connectionId: "icn_github_other_connection",
          bindingId: githubFixture.bindingId,
          secretType: "github_app_installation_token",
          resolverKey: "github_app_installation_token",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "BINDING_CONNECTION_MISMATCH",
      message:
        "Integration binding 'ibd_github_binding_aware_mismatch' does not belong to connection 'icn_github_other_connection'.",
    });
  });
});

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
