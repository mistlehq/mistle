import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  integrationTargets,
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
  userExternalPrincipalCredentialSecrets,
  UserExternalPrincipalCredentialSecretKinds,
  type UserExternalPrincipalCredentialSecretKind,
  userExternalPrincipalCredentials,
  UserExternalPrincipalCredentialStatuses,
  userExternalPrincipalKeys,
  UserExternalPrincipalKeyStatuses,
  userExternalPrincipals,
  UserExternalPrincipalStatuses,
  IntegrationConnectionStatuses,
  integrationConnections,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { reserveAvailablePort } from "@mistle/test-harness";
import { describe, expect } from "vitest";

import {
  CONTROL_PLANE_INTERNAL_AUTH_HEADER,
  INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH,
} from "../src/internal/identity-linking/index.js";
import { InternalIdentityLinkingErrorCodes } from "../src/internal/identity-linking/services/errors.js";
import {
  decryptCredentialUtf8,
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../src/lib/crypto.js";
import { it } from "./test-context.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";

type StartedGitHubTokenServer = {
  baseUrl: string;
  requests: Array<{
    method: string;
    pathname: string;
    search: string;
  }>;
  stop: () => Promise<void>;
};

async function startGitHubTokenServer(input: {
  statusCode?: number;
  responseBody: unknown;
}): Promise<StartedGitHubTokenServer> {
  const host = "127.0.0.1";
  const port = await reserveAvailablePort({ host });
  const requests: StartedGitHubTokenServer["requests"] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url === undefined) {
      response.writeHead(500);
      response.end("Missing request URL.");
      return;
    }

    const requestUrl = new URL(request.url, `http://${host}:${String(port)}`);
    requests.push({
      method: request.method ?? "GET",
      pathname: requestUrl.pathname,
      search: requestUrl.search,
    });
    response.statusCode = input.statusCode ?? 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(input.responseBody));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    baseUrl: `http://${host}:${String(port)}`,
    requests,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
  };
}

describe("internal identity-linking principal credential resolution", () => {
  it("resolves an active linked-principal access token", async ({ fixture }) => {
    const session = await fixture.authSession({
      email: "internal-identity-linking-resolve-active@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    const connectionId = await createGitHubAppConnection({
      fixture,
      authenticatedSession: session,
      displayName: "GitHub Identity",
    });
    await insertIdentityLinkProviderConfig({
      fixture,
      organizationId: session.organizationId,
      userId: session.userId,
      configId: "ilp_github_active_resolve",
      providerFamily: "github",
      targetKey: "github-cloud",
      connectionId,
      connectionDisplayName: "GitHub Identity",
      connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      createConnection: false,
    });

    await fixture.db.insert(userExternalPrincipals).values({
      id: "uep_github_active_resolve",
      organizationId: session.organizationId,
      userId: session.userId,
      providerFamily: "github",
      providerSubjectId: "12345",
      organizationProviderConfigId: "ilp_github_active_resolve",
      integrationConnectionId: connectionId,
      status: UserExternalPrincipalStatuses.ACTIVE,
      profile: {
        login: "mistle-user",
      },
    });
    await fixture.db.insert(userExternalPrincipalKeys).values({
      organizationId: session.organizationId,
      principalId: "uep_github_active_resolve",
      providerFamily: "github",
      keyType: "account_id",
      keyValue: "12345",
      status: UserExternalPrincipalKeyStatuses.ACTIVE,
    });
    await fixture.db.insert(userExternalPrincipalCredentials).values({
      id: "upc_github_active_resolve",
      organizationId: session.organizationId,
      principalId: "uep_github_active_resolve",
      providerFamily: "github",
      credentialKind: "github_app_user_access_token",
      status: UserExternalPrincipalCredentialStatuses.ACTIVE,
      accessTokenExpiresAt: "2030-01-01T00:00:00.000Z",
      refreshTokenExpiresAt: "2030-06-01T00:00:00.000Z",
    });
    await insertPrincipalCredentialSecret({
      fixture,
      organizationId: session.organizationId,
      credentialId: "upc_github_active_resolve",
      secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
      plaintext: "ghu_active_token",
    });
    await insertPrincipalCredentialSecret({
      fixture,
      organizationId: session.organizationId,
      credentialId: "upc_github_active_resolve",
      secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
      plaintext: "ghr_active_refresh_token",
    });

    const response = await fixture.request(
      `${INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH}/resolve-principal-credential`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: session.organizationId,
          actingUserId: session.userId,
          providerFamily: "github",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: "value",
      value: "ghu_active_token",
      expiresAt: "2030-01-01 00:00:00+00",
    });
  });

  it("refreshes an expired linked-principal GitHub credential and persists updated secrets", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "internal-identity-linking-refresh-success@example.com",
    });
    const refreshServer = await startGitHubTokenServer({
      responseBody: {
        access_token: "ghu_refreshed_token",
        expires_in: 3600,
        refresh_token: "ghr_refreshed_token",
        refresh_token_expires_in: 7200,
        scope: "",
        token_type: "bearer",
      },
    });

    try {
      await upsertGitHubTarget({
        fixture,
        targetKey: "github-cloud",
        apiBaseUrl: refreshServer.baseUrl,
        webBaseUrl: refreshServer.baseUrl,
      });
      const connectionId = await createGitHubAppConnection({
        fixture,
        authenticatedSession: session,
        displayName: "GitHub Identity",
      });
      await insertIdentityLinkProviderConfig({
        fixture,
        organizationId: session.organizationId,
        userId: session.userId,
        configId: "ilp_github_refresh_success",
        providerFamily: "github",
        targetKey: "github-cloud",
        connectionId,
        connectionDisplayName: "GitHub Identity",
        connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        createConnection: false,
      });

      await fixture.db.insert(userExternalPrincipals).values({
        id: "uep_github_refresh_success",
        organizationId: session.organizationId,
        userId: session.userId,
        providerFamily: "github",
        providerSubjectId: "12345",
        organizationProviderConfigId: "ilp_github_refresh_success",
        integrationConnectionId: connectionId,
        status: UserExternalPrincipalStatuses.ACTIVE,
        profile: {
          login: "mistle-user",
        },
      });
      await fixture.db.insert(userExternalPrincipalKeys).values({
        organizationId: session.organizationId,
        principalId: "uep_github_refresh_success",
        providerFamily: "github",
        keyType: "account_id",
        keyValue: "12345",
        status: UserExternalPrincipalKeyStatuses.ACTIVE,
      });
      await fixture.db.insert(userExternalPrincipalCredentials).values({
        id: "upc_github_refresh_success",
        organizationId: session.organizationId,
        principalId: "uep_github_refresh_success",
        providerFamily: "github",
        credentialKind: "github_app_user_access_token",
        status: UserExternalPrincipalCredentialStatuses.ACTIVE,
        accessTokenExpiresAt: "2020-01-01T00:00:00.000Z",
        refreshTokenExpiresAt: "2030-06-01T00:00:00.000Z",
      });
      await insertPrincipalCredentialSecret({
        fixture,
        organizationId: session.organizationId,
        credentialId: "upc_github_refresh_success",
        secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
        plaintext: "ghu_expired_token",
      });
      await insertPrincipalCredentialSecret({
        fixture,
        organizationId: session.organizationId,
        credentialId: "upc_github_refresh_success",
        secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
        plaintext: "ghr_existing_refresh_token",
      });

      const response = await fixture.request(
        `${INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH}/resolve-principal-credential`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
          },
          body: JSON.stringify({
            organizationId: session.organizationId,
            actingUserId: session.userId,
            providerFamily: "github",
          }),
        },
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        kind: "value",
        value: "ghu_refreshed_token",
      });
      expect(typeof payload["expiresAt"]).toBe("string");
      expect(refreshServer.requests).toEqual([
        {
          method: "POST",
          pathname: "/login/oauth/access_token",
          search:
            "?client_id=Iv1.client123&client_secret=github-client-secret&grant_type=refresh_token&refresh_token=ghr_existing_refresh_token",
        },
      ]);

      const persistedCredential = await fixture.db.query.userExternalPrincipalCredentials.findFirst(
        {
          where: (table, { eq }) => eq(table.id, "upc_github_refresh_success"),
        },
      );
      expect(persistedCredential?.status).toBe(UserExternalPrincipalCredentialStatuses.ACTIVE);
      expect(persistedCredential?.accessTokenExpiresAt).not.toBeNull();
      expect(persistedCredential?.refreshTokenExpiresAt).not.toBeNull();
      expect(Date.parse(persistedCredential?.accessTokenExpiresAt ?? "")).toBeGreaterThan(
        Date.now(),
      );
      expect(Date.parse(persistedCredential?.refreshTokenExpiresAt ?? "")).toBeGreaterThan(
        Date.now(),
      );
      expect(persistedCredential?.lastValidatedAt).not.toBeNull();

      const refreshedSecrets =
        await fixture.db.query.userExternalPrincipalCredentialSecrets.findMany({
          where: (table, { eq }) => eq(table.credentialId, "upc_github_refresh_success"),
        });
      expect(refreshedSecrets).toHaveLength(2);
      expect(
        await decryptUserExternalPrincipalCredentialSecret({
          fixture,
          organizationId: session.organizationId,
          credentialId: "upc_github_refresh_success",
          secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
        }),
      ).toBe("ghu_refreshed_token");
      expect(
        await decryptUserExternalPrincipalCredentialSecret({
          fixture,
          organizationId: session.organizationId,
          credentialId: "upc_github_refresh_success",
          secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
        }),
      ).toBe("ghr_refreshed_token");
    } finally {
      await refreshServer.stop();
    }
  });

  it("marks the credential as reauthorization required when GitHub refresh fails", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "internal-identity-linking-refresh-failure@example.com",
    });
    const refreshServer = await startGitHubTokenServer({
      statusCode: 401,
      responseBody: {
        error: "bad_credentials",
      },
    });

    try {
      await upsertGitHubTarget({
        fixture,
        targetKey: "github-cloud",
        apiBaseUrl: refreshServer.baseUrl,
        webBaseUrl: refreshServer.baseUrl,
      });
      const connectionId = await createGitHubAppConnection({
        fixture,
        authenticatedSession: session,
        displayName: "GitHub Identity",
      });
      await insertIdentityLinkProviderConfig({
        fixture,
        organizationId: session.organizationId,
        userId: session.userId,
        configId: "ilp_github_refresh_failure",
        providerFamily: "github",
        targetKey: "github-cloud",
        connectionId,
        connectionDisplayName: "GitHub Identity",
        connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        createConnection: false,
      });

      await fixture.db.insert(userExternalPrincipals).values({
        id: "uep_github_refresh_failure",
        organizationId: session.organizationId,
        userId: session.userId,
        providerFamily: "github",
        providerSubjectId: "12345",
        organizationProviderConfigId: "ilp_github_refresh_failure",
        integrationConnectionId: connectionId,
        status: UserExternalPrincipalStatuses.ACTIVE,
        profile: {
          login: "mistle-user",
        },
      });
      await fixture.db.insert(userExternalPrincipalKeys).values({
        organizationId: session.organizationId,
        principalId: "uep_github_refresh_failure",
        providerFamily: "github",
        keyType: "account_id",
        keyValue: "12345",
        status: UserExternalPrincipalKeyStatuses.ACTIVE,
      });
      await fixture.db.insert(userExternalPrincipalCredentials).values({
        id: "upc_github_refresh_failure",
        organizationId: session.organizationId,
        principalId: "uep_github_refresh_failure",
        providerFamily: "github",
        credentialKind: "github_app_user_access_token",
        status: UserExternalPrincipalCredentialStatuses.ACTIVE,
        accessTokenExpiresAt: "2020-01-01T00:00:00.000Z",
        refreshTokenExpiresAt: "2030-06-01T00:00:00.000Z",
      });
      await insertPrincipalCredentialSecret({
        fixture,
        organizationId: session.organizationId,
        credentialId: "upc_github_refresh_failure",
        secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
        plaintext: "ghu_expired_token",
      });
      await insertPrincipalCredentialSecret({
        fixture,
        organizationId: session.organizationId,
        credentialId: "upc_github_refresh_failure",
        secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
        plaintext: "ghr_existing_refresh_token",
      });

      const response = await fixture.request(
        `${INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH}/resolve-principal-credential`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
          },
          body: JSON.stringify({
            organizationId: session.organizationId,
            actingUserId: session.userId,
            providerFamily: "github",
          }),
        },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        code: InternalIdentityLinkingErrorCodes.CREDENTIAL_REAUTHORIZATION_REQUIRED,
        message:
          'GitHub refresh token exchange failed (401 Unauthorized): {"error":"bad_credentials"}',
      });

      const persistedCredential = await fixture.db.query.userExternalPrincipalCredentials.findFirst(
        {
          where: (table, { eq }) => eq(table.id, "upc_github_refresh_failure"),
        },
      );
      expect(persistedCredential?.status).toBe(
        UserExternalPrincipalCredentialStatuses.REAUTHORIZATION_REQUIRED,
      );
    } finally {
      await refreshServer.stop();
    }
  });
});

async function upsertGitHubTarget(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  targetKey: string;
  apiBaseUrl?: string;
  webBaseUrl?: string;
}): Promise<void> {
  const apiBaseUrl = input.apiBaseUrl ?? "https://api.github.com";
  const webBaseUrl = input.webBaseUrl ?? "https://github.com";

  await input.fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: apiBaseUrl,
        web_base_url: webBaseUrl,
      },
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: apiBaseUrl,
          web_base_url: webBaseUrl,
        },
      },
    });
}

async function insertIdentityLinkProviderConfig(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  userId: string;
  configId: string;
  providerFamily: string;
  targetKey: string;
  connectionId: string;
  connectionDisplayName: string;
  connectionMethodId: string;
  configurationStatus: "active" | "disabled";
  connectionConfig?: Record<string, unknown>;
  createConnection?: boolean;
}): Promise<void> {
  if (input.createConnection !== false) {
    await input.fixture.db.insert(integrationConnections).values({
      id: input.connectionId,
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      displayName: input.connectionDisplayName,
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: input.connectionMethodId,
        ...input.connectionConfig,
      },
    });
  }

  await input.fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
    id: input.configId,
    organizationId: input.organizationId,
    providerFamily: input.providerFamily,
    status: input.configurationStatus,
    integrationTargetKey: input.targetKey,
    integrationConnectionId: input.connectionId,
    createdByUserId: input.userId,
    updatedByUserId: input.userId,
  });
}

async function createGitHubAppConnection(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  authenticatedSession: Awaited<ReturnType<ControlPlaneApiIntegrationFixture["authSession"]>>;
  displayName: string;
}): Promise<string> {
  const response = await input.fixture.request("/v1/integration/connections/github-cloud/form", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: input.authenticatedSession.cookie,
    },
    body: JSON.stringify({
      displayName: input.displayName,
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      config: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
      },
      secrets: {
        appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
        clientSecret: "github-client-secret",
        webhookSecret: "github-webhook-secret",
      },
    }),
  });

  expect(response.status).toBe(201);
  const createdConnection = await response.json();
  if (typeof createdConnection !== "object" || createdConnection === null) {
    throw new Error("Expected GitHub App connection create response object.");
  }

  const connectionId = createdConnection["id"];
  if (typeof connectionId !== "string" || connectionId.length === 0) {
    throw new Error("Expected GitHub App connection id.");
  }

  return connectionId;
}

async function insertPrincipalCredentialSecret(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  credentialId: string;
  secretKind: UserExternalPrincipalCredentialSecretKind;
  plaintext: string;
}): Promise<void> {
  const organizationCredentialKey =
    await input.fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, input.organizationId),
    });
  if (organizationCredentialKey === undefined) {
    throw new Error("Expected organization credential key.");
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.fixture.config.integrations.masterEncryptionKeys,
  });
  const organizationCredentialKeyMaterial = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const encryptedSecret = encryptCredentialUtf8({
      plaintext: input.plaintext,
      organizationCredentialKey: organizationCredentialKeyMaterial,
    });

    await input.fixture.db.insert(userExternalPrincipalCredentialSecrets).values({
      organizationId: input.organizationId,
      credentialId: input.credentialId,
      secretKind: input.secretKind,
      ciphertext: encryptedSecret.ciphertext,
      nonce: encryptedSecret.nonce,
      organizationCredentialKeyVersion: organizationCredentialKey.version,
    });
  } finally {
    organizationCredentialKeyMaterial.fill(0);
  }
}

async function decryptUserExternalPrincipalCredentialSecret(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  credentialId: string;
  secretKind: UserExternalPrincipalCredentialSecretKind;
}): Promise<string> {
  const encryptedSecret =
    await input.fixture.db.query.userExternalPrincipalCredentialSecrets.findFirst({
      where: (table, { and, eq, isNull }) =>
        and(
          eq(table.organizationId, input.organizationId),
          eq(table.credentialId, input.credentialId),
          eq(table.secretKind, input.secretKind),
          isNull(table.revokedAt),
        ),
    });
  if (encryptedSecret === undefined) {
    throw new Error("Expected encrypted linked-principal credential secret.");
  }

  const organizationCredentialKey =
    await input.fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, input.organizationId),
          eq(table.version, encryptedSecret.organizationCredentialKeyVersion),
        ),
    });
  if (organizationCredentialKey === undefined) {
    throw new Error("Expected organization credential key.");
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.fixture.config.integrations.masterEncryptionKeys,
  });
  const organizationCredentialKeyMaterial = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    return decryptCredentialUtf8({
      nonce: encryptedSecret.nonce,
      ciphertext: encryptedSecret.ciphertext,
      organizationCredentialKey: organizationCredentialKeyMaterial,
    });
  } finally {
    organizationCredentialKeyMaterial.fill(0);
  }
}
