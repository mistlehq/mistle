/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalCredentialSecretKinds,
  UserExternalPrincipalCredentialStatuses,
  UserExternalPrincipalKeyStatuses,
  UserExternalPrincipalStatuses,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { StartLinkedAccountAuthorizationResponseSchema } from "../src/me/index.js";
import {
  createGitHubIdentityConnection,
  createSlackIdentityConnection,
  decryptPrincipalCredentialSecretByKind,
  seedIdentityConnection,
  seedIdentityProviderConfig,
  upsertGitHubIdentityTarget,
  upsertSlackIdentityTarget,
} from "./helpers/identity-linking.js";
import {
  type SimulatedProviderRequest,
  startSimulatedGitHubIdentityProvider,
  startSimulatedSlackIdentityProvider,
} from "./helpers/simulated-identity-providers.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("me linked accounts callback integration", () => {
  it("completes the GitHub callback and persists principal, keys, and credential secrets", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-callback-github@example.com",
    });
    const simulatedGitHub = await startSimulatedGitHubIdentityProvider();
    const targetKey = "github-callback-success";

    try {
      await upsertGitHubIdentityTarget(env, {
        targetKey,
        apiBaseUrl: simulatedGitHub.baseUrl,
        webBaseUrl: simulatedGitHub.baseUrl,
      });
      const connectionId = await createGitHubIdentityConnection(env, {
        displayName: "GitHub Identity",
        session,
        targetKey,
      });
      await seedIdentityProviderConfig(env, {
        configId: "ilp_me_linked_accounts_callback_github",
        connectionId,
        organizationId: session.organizationId,
        providerFamily: "github",
        status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        targetKey,
        userId: session.userId,
      });

      const startResponse = await env.controlPlaneApi.http.fetch("/v1/me/linked-accounts/github", {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      });
      expect(startResponse.status).toBe(200);
      const startPayload = StartLinkedAccountAuthorizationResponseSchema.parse(
        await startResponse.json(),
      );
      const authorizationUrl = new URL(startPayload.authorizationUrl);
      const state = authorizationUrl.searchParams.get("state");
      const redirectUri = authorizationUrl.searchParams.get("redirect_uri");
      expect(state).toBeTruthy();
      expect(redirectUri).toBeTruthy();

      const callbackResponse = await env.controlPlaneApi.http.fetch(
        `/p/identity-linking/callbacks/github?state=${encodeURIComponent(state ?? "__missing__")}&code=code_123`,
        {
          redirect: "manual",
        },
      );

      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.headers.get("location")).toBe(
        "http://localhost:5173/settings/account/profile?linkedAccountProvider=github&linkedAccountResult=success",
      );

      const tokenRequest = readProviderRequest(
        simulatedGitHub.requests,
        "/login/oauth/access_token",
      );
      expect(tokenRequest.method).toBe("POST");
      const tokenRequestUrl = new URL(
        `http://provider.test${tokenRequest.pathname}${tokenRequest.search}`,
      );
      expect(tokenRequestUrl.searchParams.get("client_id")).toBe("Iv1.client123");
      expect(tokenRequestUrl.searchParams.get("client_secret")).toBe("github-client-secret");
      expect(tokenRequestUrl.searchParams.get("code")).toBe("code_123");
      expect(tokenRequestUrl.searchParams.get("redirect_uri")).toBe(redirectUri);
      expect(tokenRequestUrl.searchParams.get("code_verifier")).toBeTruthy();
      expect(readProviderRequest(simulatedGitHub.requests, "/user").authorization).toBe(
        "Bearer ghu_user_token",
      );
      expect(readProviderRequest(simulatedGitHub.requests, "/user/emails").authorization).toBe(
        "Bearer ghu_user_token",
      );

      const principal = await env.controlPlaneDb.query.userExternalPrincipals.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, session.organizationId),
            eq(table.userId, session.userId),
            eq(table.providerFamily, "github"),
          ),
      });
      expect(principal).toMatchObject({
        organizationId: session.organizationId,
        userId: session.userId,
        providerFamily: "github",
        providerSubjectId: "12345",
        organizationProviderConfigId: "ilp_me_linked_accounts_callback_github",
        integrationConnectionId: connectionId,
        status: UserExternalPrincipalStatuses.ACTIVE,
        profile: {
          login: "mistle-user",
          displayName: "Mistle User",
          avatarUrl: "https://avatars.example.com/u/12345",
          preferredEmail: "mistle-user@example.com",
          availableEmails: [
            {
              email: "mistle-user@example.com",
              primary: true,
              verified: true,
            },
          ],
        },
      });
      expect(principal?.linkedAt).toBeTruthy();

      const keys = await env.controlPlaneDb.query.userExternalPrincipalKeys.findMany({
        columns: {
          keyType: true,
          keyValue: true,
          status: true,
        },
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, session.organizationId),
            eq(table.principalId, principal?.id ?? "__missing__"),
          ),
        orderBy: (table, { asc }) => [asc(table.keyType)],
      });
      expect(keys).toEqual([
        {
          keyType: "account_id",
          keyValue: "12345",
          status: UserExternalPrincipalKeyStatuses.ACTIVE,
        },
        {
          keyType: "login",
          keyValue: "mistle-user",
          status: UserExternalPrincipalKeyStatuses.ACTIVE,
        },
      ]);

      const credential = await env.controlPlaneDb.query.userExternalPrincipalCredentials.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, session.organizationId),
            eq(table.principalId, principal?.id ?? "__missing__"),
          ),
      });
      expect(credential).toMatchObject({
        organizationId: session.organizationId,
        principalId: principal?.id,
        providerFamily: "github",
        credentialKind: "github_app_user_access_token",
        status: UserExternalPrincipalCredentialStatuses.ACTIVE,
        scopes: ["pull_requests:write", "repo"],
      });
      expect(credential?.accessTokenExpiresAt).toBeTruthy();
      expect(credential?.refreshTokenExpiresAt).toBeTruthy();
      if (credential === undefined) {
        throw new Error("Expected GitHub linked-account credential.");
      }
      await expect(
        decryptPrincipalCredentialSecretByKind(env, {
          organizationId: session.organizationId,
          credentialId: credential.id,
          secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
        }),
      ).resolves.toBe("ghu_user_token");
      await expect(
        decryptPrincipalCredentialSecretByKind(env, {
          organizationId: session.organizationId,
          credentialId: credential.id,
          secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
        }),
      ).resolves.toBe("ghr_refresh_token");

      const consumedRedirectSession =
        await env.controlPlaneDb.query.identityLinkRedirectSessions.findFirst({
          where: (table, { and, eq }) =>
            and(
              eq(table.organizationId, session.organizationId),
              eq(table.providerFamily, "github"),
              eq(table.state, state ?? "__missing__"),
            ),
        });
      expect(consumedRedirectSession?.usedAt).toBeTruthy();
    } finally {
      await simulatedGitHub.stop();
    }
  });

  it("completes the Slack callback and persists a user token without a refresh token", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-callback-slack@example.com",
    });
    const simulatedSlack = await startSimulatedSlackIdentityProvider();
    const targetKey = "slack-callback-success";

    try {
      await upsertSlackIdentityTarget(env, {
        targetKey,
        apiBaseUrl: `${simulatedSlack.baseUrl}/api`,
      });
      const connectionId = await createSlackIdentityConnection(env, {
        displayName: "Slack Identity",
        session,
        targetKey,
      });
      await seedIdentityProviderConfig(env, {
        configId: "ilp_me_linked_accounts_callback_slack",
        connectionId,
        organizationId: session.organizationId,
        providerFamily: "slack",
        status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        targetKey,
        userId: session.userId,
      });

      const startResponse = await env.controlPlaneApi.http.fetch("/v1/me/linked-accounts/slack", {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      });
      expect(startResponse.status).toBe(200);
      const startPayload = StartLinkedAccountAuthorizationResponseSchema.parse(
        await startResponse.json(),
      );
      const authorizationUrl = new URL(startPayload.authorizationUrl);
      const state = authorizationUrl.searchParams.get("state");
      const redirectUri = authorizationUrl.searchParams.get("redirect_uri");
      expect(state).toBeTruthy();
      expect(redirectUri).toBeTruthy();

      const callbackResponse = await env.controlPlaneApi.http.fetch(
        `/p/identity-linking/callbacks/slack?state=${encodeURIComponent(state ?? "__missing__")}&code=code_123`,
        {
          redirect: "manual",
        },
      );

      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.headers.get("location")).toBe(
        "http://localhost:5173/settings/account/profile?linkedAccountProvider=slack&linkedAccountResult=success",
      );

      const tokenRequest = readProviderRequest(simulatedSlack.requests, "/api/oauth.v2.access");
      expect(tokenRequest.method).toBe("POST");
      const tokenRequestBody = new URLSearchParams(tokenRequest.body);
      expect(tokenRequestBody.get("client_id")).toBe("123.456");
      expect(tokenRequestBody.get("client_secret")).toBe("slack-client-secret");
      expect(tokenRequestBody.get("code")).toBe("code_123");
      expect(tokenRequestBody.get("redirect_uri")).toBe(redirectUri);
      const profileRequest = readProviderRequest(simulatedSlack.requests, "/api/users.profile.get");
      expect(profileRequest.search).toBe("?user=U12345");
      expect(profileRequest.authorization).toBe("Bearer xoxe.xoxp-slack-user-token");

      const principal = await env.controlPlaneDb.query.userExternalPrincipals.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, session.organizationId),
            eq(table.userId, session.userId),
            eq(table.providerFamily, "slack"),
          ),
      });
      expect(principal).toMatchObject({
        organizationId: session.organizationId,
        userId: session.userId,
        providerFamily: "slack",
        providerSubjectId: "T12345:U12345",
        organizationProviderConfigId: "ilp_me_linked_accounts_callback_slack",
        integrationConnectionId: connectionId,
        status: UserExternalPrincipalStatuses.ACTIVE,
        profile: {
          workspaceId: "T12345",
          workspaceName: "Mistle Engineering",
          displayName: "Mistle Slack User",
          avatarUrl: "https://avatars.slack-edge.com/u12345.png",
          email: "mistle-slack-user@example.com",
        },
      });

      const keys = await env.controlPlaneDb.query.userExternalPrincipalKeys.findMany({
        columns: {
          keyType: true,
          keyValue: true,
          status: true,
        },
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, session.organizationId),
            eq(table.principalId, principal?.id ?? "__missing__"),
          ),
        orderBy: (table, { asc }) => [asc(table.keyType)],
      });
      expect(keys).toEqual([
        {
          keyType: "user_id",
          keyValue: "U12345",
          status: UserExternalPrincipalKeyStatuses.ACTIVE,
        },
        {
          keyType: "workspace_id",
          keyValue: "T12345",
          status: UserExternalPrincipalKeyStatuses.ACTIVE,
        },
      ]);

      const credential = await env.controlPlaneDb.query.userExternalPrincipalCredentials.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, session.organizationId),
            eq(table.principalId, principal?.id ?? "__missing__"),
          ),
      });
      expect(credential).toMatchObject({
        organizationId: session.organizationId,
        principalId: principal?.id,
        providerFamily: "slack",
        credentialKind: "slack_user_token",
        status: UserExternalPrincipalCredentialStatuses.ACTIVE,
        scopes: ["users.profile:read", "users:read", "users:read.email"],
        refreshTokenExpiresAt: null,
      });
      expect(credential?.accessTokenExpiresAt).toBeTruthy();
      if (credential === undefined) {
        throw new Error("Expected Slack linked-account credential.");
      }
      await expect(
        decryptPrincipalCredentialSecretByKind(env, {
          organizationId: session.organizationId,
          credentialId: credential.id,
          secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
        }),
      ).resolves.toBe("xoxe.xoxp-slack-user-token");
    } finally {
      await simulatedSlack.stop();
    }
  });

  it("redirects with failure details when the callback state does not exist", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
      "/p/identity-linking/callbacks/github?state=missing-state",
      {
        redirect: "manual",
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:5173/settings/account/profile?linkedAccountProvider=github&linkedAccountResult=failure&linkedAccountCode=REDIRECT_STATE_INVALID",
    );
  });

  it("redirects with failure details when the callback state has expired", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-callback-expired@example.com",
    });
    await seedRedirectFailureContext(env, {
      connectionId: "icn_me_linked_accounts_callback_expired",
      configId: "ilp_me_linked_accounts_callback_expired",
      organizationId: session.organizationId,
      state: "state-expired",
      userId: session.userId,
      expiresAt: "2020-04-18T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/p/identity-linking/callbacks/github?state=state-expired",
      {
        redirect: "manual",
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:5173/settings/account/profile?linkedAccountProvider=github&linkedAccountResult=failure&linkedAccountCode=REDIRECT_STATE_EXPIRED",
    );
  });

  it("redirects with failure details when the callback state was already consumed", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-callback-used@example.com",
    });
    await seedRedirectFailureContext(env, {
      connectionId: "icn_me_linked_accounts_callback_used",
      configId: "ilp_me_linked_accounts_callback_used",
      organizationId: session.organizationId,
      state: "state-used",
      userId: session.userId,
      expiresAt: "2030-04-19T00:00:00.000Z",
      usedAt: "2026-04-18T10:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/p/identity-linking/callbacks/github?state=state-used",
      {
        redirect: "manual",
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:5173/settings/account/profile?linkedAccountProvider=github&linkedAccountResult=failure&linkedAccountCode=REDIRECT_STATE_ALREADY_USED",
    );
  });
});

async function seedRedirectFailureContext(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    userId: string;
    configId: string;
    connectionId: string;
    targetKey?: string;
    state: string;
    expiresAt: string;
    usedAt?: string;
  },
): Promise<void> {
  const targetKey = input.targetKey ?? `github-${input.state}`;
  await upsertGitHubIdentityTarget(env, { targetKey });
  await seedIdentityConnection(env, {
    connectionId: input.connectionId,
    displayName: "GitHub Identity",
    methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    organizationId: input.organizationId,
    targetKey,
  });
  await seedIdentityProviderConfig(env, {
    configId: input.configId,
    connectionId: input.connectionId,
    organizationId: input.organizationId,
    providerFamily: "github",
    status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    targetKey,
    userId: input.userId,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.identityLinkRedirectSessions).values({
    organizationId: input.organizationId,
    userId: input.userId,
    providerFamily: "github",
    organizationProviderConfigId: input.configId,
    integrationConnectionId: input.connectionId,
    state: input.state,
    expiresAt: input.expiresAt,
    ...(input.usedAt === undefined ? {} : { usedAt: input.usedAt }),
  });
}

function readProviderRequest(
  requests: SimulatedProviderRequest[],
  pathname: string,
): SimulatedProviderRequest {
  const request = requests.find((candidate) => candidate.pathname === pathname);
  if (request === undefined) {
    throw new Error(`Expected simulated provider request to ${pathname}.`);
  }

  return request;
}
