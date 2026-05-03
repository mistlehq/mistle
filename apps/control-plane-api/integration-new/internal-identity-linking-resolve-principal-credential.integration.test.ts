/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalCredentialSecretKinds,
  UserExternalPrincipalCredentialStatuses,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationAuthenticatedSession,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  CONTROL_PLANE_INTERNAL_AUTH_HEADER,
  INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH,
} from "../src/internal/identity-linking/index.js";
import { ResolvePrincipalCredentialResponseSchema } from "../src/internal/identity-linking/resolve-principal-credential/schema.js";
import { InternalIdentityLinkingErrorCodes } from "../src/internal/identity-linking/services/errors.js";
import {
  createGitHubIdentityConnection,
  decryptPrincipalCredentialSecretByKind,
  insertPrincipalCredentialSecret,
  seedGitHubLinkedPrincipal,
  seedIdentityProviderConfig,
  seedPrincipalCredential,
  upsertGitHubIdentityTarget,
} from "./helpers/identity-linking.js";
import { startSimulatedGitHubIdentityProvider } from "./helpers/simulated-identity-providers.js";

const InternalServiceToken = "integration-new-internal-service-token";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("internal identity-linking principal credential resolution", () => {
  it("resolves an active linked-principal access token", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-identity-linking-resolve-active@example.com",
    });
    await seedGitHubPrincipalCredential(env, {
      accessToken: "ghu_active_token",
      accessTokenExpiresAt: "2030-01-01T00:00:00.000Z",
      credentialId: "upc_internal_identity_linking_resolve_active",
      providerConfigId: "ilp_internal_identity_linking_resolve_active",
      principalId: "uep_internal_identity_linking_resolve_active",
      refreshToken: "ghr_active_refresh_token",
      refreshTokenExpiresAt: "2030-06-01T00:00:00.000Z",
      session,
      targetKey: "github-internal-identity-linking-resolve-active",
    });

    const response = await resolvePrincipalCredential(env, {
      organizationId: session.organizationId,
      actingUserId: session.userId,
      providerFamily: "github",
    });

    expect(response.status).toBe(200);
    expect(ResolvePrincipalCredentialResponseSchema.parse(await response.json())).toMatchObject({
      kind: "value",
      value: "ghu_active_token",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
  });

  it("refreshes an expired GitHub credential and persists updated secrets", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-identity-linking-refresh-success@example.com",
    });
    const simulatedGitHub = await startSimulatedGitHubIdentityProvider({
      tokenResponse: {
        access_token: "ghu_refreshed_token",
        expires_in: 3_600,
        refresh_token: "ghr_refreshed_token",
        refresh_token_expires_in: 7_200,
        scope: "",
        token_type: "bearer",
      },
    });

    try {
      await seedGitHubPrincipalCredential(env, {
        accessToken: "ghu_expired_token",
        accessTokenExpiresAt: "2020-01-01T00:00:00.000Z",
        apiBaseUrl: simulatedGitHub.baseUrl,
        credentialId: "upc_internal_identity_linking_refresh_success",
        providerConfigId: "ilp_internal_identity_linking_refresh_success",
        principalId: "uep_internal_identity_linking_refresh_success",
        refreshToken: "ghr_existing_refresh_token",
        refreshTokenExpiresAt: "2030-06-01T00:00:00.000Z",
        session,
        targetKey: "github-internal-identity-linking-refresh-success",
        webBaseUrl: simulatedGitHub.baseUrl,
      });

      const response = await resolvePrincipalCredential(env, {
        organizationId: session.organizationId,
        actingUserId: session.userId,
        providerFamily: "github",
      });

      expect(response.status).toBe(200);
      expect(ResolvePrincipalCredentialResponseSchema.parse(await response.json())).toMatchObject({
        kind: "value",
        value: "ghu_refreshed_token",
      });

      const refreshRequest = simulatedGitHub.requests.find(
        (request) => request.pathname === "/login/oauth/access_token",
      );
      if (refreshRequest === undefined) {
        throw new Error("Expected simulated GitHub token refresh request.");
      }
      const refreshUrl = new URL(
        `http://provider.test${refreshRequest.pathname}${refreshRequest.search}`,
      );
      expect(refreshRequest.method).toBe("POST");
      expect(refreshUrl.searchParams.get("client_id")).toBe("Iv1.client123");
      expect(refreshUrl.searchParams.get("client_secret")).toBe("github-client-secret");
      expect(refreshUrl.searchParams.get("grant_type")).toBe("refresh_token");
      expect(refreshUrl.searchParams.get("refresh_token")).toBe("ghr_existing_refresh_token");

      const persistedCredential =
        await env.controlPlaneDb.query.userExternalPrincipalCredentials.findFirst({
          where: (table, { eq }) => eq(table.id, "upc_internal_identity_linking_refresh_success"),
        });
      expect(persistedCredential?.status).toBe(UserExternalPrincipalCredentialStatuses.ACTIVE);
      expect(persistedCredential?.lastValidatedAt).toBeTruthy();
      expect(Date.parse(persistedCredential?.accessTokenExpiresAt ?? "")).toBeGreaterThan(
        Date.now(),
      );
      expect(Date.parse(persistedCredential?.refreshTokenExpiresAt ?? "")).toBeGreaterThan(
        Date.now(),
      );
      await expect(
        decryptPrincipalCredentialSecretByKind(env, {
          organizationId: session.organizationId,
          credentialId: "upc_internal_identity_linking_refresh_success",
          secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
        }),
      ).resolves.toBe("ghu_refreshed_token");
      await expect(
        decryptPrincipalCredentialSecretByKind(env, {
          organizationId: session.organizationId,
          credentialId: "upc_internal_identity_linking_refresh_success",
          secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
        }),
      ).resolves.toBe("ghr_refreshed_token");
    } finally {
      await simulatedGitHub.stop();
    }
  });

  it("marks the credential as reauthorization required when GitHub refresh fails", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-identity-linking-refresh-failure@example.com",
    });
    const simulatedGitHub = await startSimulatedGitHubIdentityProvider({
      tokenStatusCode: 401,
      tokenResponse: {
        error: "bad_credentials",
      },
    });

    try {
      await seedGitHubPrincipalCredential(env, {
        accessToken: "ghu_expired_token",
        accessTokenExpiresAt: "2020-01-01T00:00:00.000Z",
        apiBaseUrl: simulatedGitHub.baseUrl,
        credentialId: "upc_internal_identity_linking_refresh_failure",
        providerConfigId: "ilp_internal_identity_linking_refresh_failure",
        principalId: "uep_internal_identity_linking_refresh_failure",
        refreshToken: "ghr_existing_refresh_token",
        refreshTokenExpiresAt: "2030-06-01T00:00:00.000Z",
        session,
        targetKey: "github-internal-identity-linking-refresh-failure",
        webBaseUrl: simulatedGitHub.baseUrl,
      });

      const response = await resolvePrincipalCredential(env, {
        organizationId: session.organizationId,
        actingUserId: session.userId,
        providerFamily: "github",
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        code: InternalIdentityLinkingErrorCodes.CREDENTIAL_REAUTHORIZATION_REQUIRED,
        message:
          'GitHub refresh token exchange failed (401 Unauthorized): {"error":"bad_credentials"}',
      });

      const persistedCredential =
        await env.controlPlaneDb.query.userExternalPrincipalCredentials.findFirst({
          where: (table, { eq }) => eq(table.id, "upc_internal_identity_linking_refresh_failure"),
        });
      expect(persistedCredential?.status).toBe(
        UserExternalPrincipalCredentialStatuses.REAUTHORIZATION_REQUIRED,
      );
    } finally {
      await simulatedGitHub.stop();
    }
  });
});

async function seedGitHubPrincipalCredential(
  env: IntegrationTestEnvironment,
  input: {
    session: IntegrationAuthenticatedSession;
    targetKey: string;
    providerConfigId: string;
    principalId: string;
    credentialId: string;
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshToken: string;
    refreshTokenExpiresAt: string;
    apiBaseUrl?: string;
    webBaseUrl?: string;
  },
): Promise<void> {
  await upsertGitHubIdentityTarget(env, {
    targetKey: input.targetKey,
    apiBaseUrl: input.apiBaseUrl,
    webBaseUrl: input.webBaseUrl,
  });
  const connectionId = await createGitHubIdentityConnection(env, {
    displayName: "GitHub Identity",
    session: input.session,
    targetKey: input.targetKey,
  });
  await seedIdentityProviderConfig(env, {
    configId: input.providerConfigId,
    connectionId,
    organizationId: input.session.organizationId,
    providerFamily: "github",
    status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    targetKey: input.targetKey,
    userId: input.session.userId,
  });
  await seedGitHubLinkedPrincipal(env, {
    organizationId: input.session.organizationId,
    userId: input.session.userId,
    principalId: input.principalId,
    providerConfigId: input.providerConfigId,
    connectionId,
    providerSubjectId: "12345",
    profile: {
      login: "mistle-user",
    },
  });
  await seedPrincipalCredential(env, {
    credentialId: input.credentialId,
    organizationId: input.session.organizationId,
    principalId: input.principalId,
    providerFamily: "github",
    credentialKind: "github_app_user_access_token",
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    refreshTokenExpiresAt: input.refreshTokenExpiresAt,
  });
  await insertPrincipalCredentialSecret(env, {
    organizationId: input.session.organizationId,
    credentialId: input.credentialId,
    secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
    plaintext: input.accessToken,
  });
  await insertPrincipalCredentialSecret(env, {
    organizationId: input.session.organizationId,
    credentialId: input.credentialId,
    secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
    plaintext: input.refreshToken,
  });
}

async function resolvePrincipalCredential(
  env: IntegrationTestEnvironment,
  body: {
    organizationId: string;
    actingUserId: string;
    providerFamily: string;
  },
): Promise<Response> {
  return await env.controlPlaneApi.http.fetch(
    `${INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH}/resolve-principal-credential`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: InternalServiceToken,
      },
      body: JSON.stringify(body),
    },
  );
}
