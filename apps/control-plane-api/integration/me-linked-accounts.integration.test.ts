import { once } from "node:events";
import { createServer } from "node:http";

import {
  identityLinkRedirectSessions,
  integrationConnections,
  integrationTargets,
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalCredentialSecretKinds,
  userExternalPrincipalCredentials,
  userExternalPrincipalKeys,
  userExternalPrincipals,
  UserExternalPrincipalCredentialStatuses,
  UserExternalPrincipalKeyStatuses,
  UserExternalPrincipalStatuses,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { SlackConnectionMethodIds } from "@mistle/integrations-definitions";
import { reserveAvailablePort } from "@mistle/test-harness";
import { describe, expect } from "vitest";

import {
  persistIdentityLinkRedirectSession,
  resolveIdentityLinkProviderState,
  resolveIdentityLinkRedirectSecret,
} from "../src/identity-linking/services/redirect-flow.js";
import { decryptCredentialUtf8, unwrapOrganizationCredentialKey } from "../src/lib/crypto.js";
import {
  LinkedAccountsResponseSchema,
  StartLinkedAccountAuthorizationResponseSchema,
} from "../src/me/index.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";
import { it } from "./test-context.js";

describe("me linked accounts integration", () => {
  it("lists configured providers with current-user principal and credential summaries", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "me-linked-accounts-list@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    await upsertSlackTarget({
      fixture,
      targetKey: "slack-default",
    });
    await insertIdentityLinkProviderConfig({
      fixture,
      organizationId: session.organizationId,
      userId: session.userId,
      configId: "ilp_github",
      providerFamily: "github",
      targetKey: "github-cloud",
      connectionId: "icn_github_identity",
      connectionDisplayName: "GitHub Identity",
      connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    });
    await insertIdentityLinkProviderConfig({
      fixture,
      organizationId: session.organizationId,
      userId: session.userId,
      configId: "ilp_slack",
      providerFamily: "slack",
      targetKey: "slack-default",
      connectionId: "icn_slack_identity",
      connectionDisplayName: "Slack Identity",
      connectionMethodId: SlackConnectionMethodIds.SLACK_APP,
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
    });
    await fixture.db.insert(userExternalPrincipals).values({
      id: "uep_github_active",
      organizationId: session.organizationId,
      userId: session.userId,
      providerFamily: "github",
      providerSubjectId: "12345",
      organizationProviderConfigId: "ilp_github",
      integrationConnectionId: "icn_github_identity",
      status: UserExternalPrincipalStatuses.ACTIVE,
      profile: {
        login: "mistle-user",
      },
    });
    await fixture.db.insert(userExternalPrincipalKeys).values({
      organizationId: session.organizationId,
      principalId: "uep_github_active",
      providerFamily: "github",
      keyType: "account_id",
      keyValue: "12345",
      status: UserExternalPrincipalKeyStatuses.ACTIVE,
    });
    await fixture.db.insert(userExternalPrincipalCredentials).values({
      id: "upc_github_active",
      organizationId: session.organizationId,
      principalId: "uep_github_active",
      providerFamily: "github",
      credentialKind: "github_app_user_access_token",
      status: UserExternalPrincipalCredentialStatuses.ACTIVE,
      accessTokenExpiresAt: "2026-04-18T12:00:00.000Z",
      refreshTokenExpiresAt: "2026-10-18T12:00:00.000Z",
      lastValidatedAt: "2026-04-18T10:00:00.000Z",
    });

    const response = await fixture.request("/v1/me/linked-accounts", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const payload = LinkedAccountsResponseSchema.parse(await response.json());

    expect(payload).toEqual({
      linkedAccounts: [
        {
          providerFamily: "github",
          displayName: "GitHub",
          logoKey: "github",
          configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
          principal: {
            id: "uep_github_active",
            status: UserExternalPrincipalStatuses.ACTIVE,
            providerSubjectId: "12345",
            profile: {
              login: "mistle-user",
            },
            linkedAt: payload.linkedAccounts[0]?.principal?.linkedAt ?? "",
            updatedAt: payload.linkedAccounts[0]?.principal?.updatedAt ?? "",
          },
          credential: {
            id: "upc_github_active",
            credentialKind: "github_app_user_access_token",
            status: UserExternalPrincipalCredentialStatuses.ACTIVE,
            accessTokenExpiresAt: payload.linkedAccounts[0]?.credential?.accessTokenExpiresAt ?? "",
            refreshTokenExpiresAt:
              payload.linkedAccounts[0]?.credential?.refreshTokenExpiresAt ?? "",
            lastValidatedAt: payload.linkedAccounts[0]?.credential?.lastValidatedAt ?? "",
            updatedAt: payload.linkedAccounts[0]?.credential?.updatedAt ?? "",
          },
        },
        {
          providerFamily: "slack",
          displayName: "Slack",
          logoKey: "slack",
          configurationStatus: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
          principal: null,
          credential: null,
        },
      ],
    });
  });

  it("rejects starting a linked-account authorization when no active provider config exists", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "me-linked-accounts-start-no-config@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });

    const response = await fixture.request("/v1/me/linked-accounts/github", {
      method: "POST",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "PROVIDER_CONFIG_NOT_FOUND",
      message: "Identity-linking provider 'github' is not configured for this organization.",
    });
  });

  it("starts GitHub linked-account authorization and persists redirect session state", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "me-linked-accounts-start-github@example.com",
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
      configId: "ilp_github_start",
      providerFamily: "github",
      targetKey: "github-cloud",
      connectionId,
      connectionDisplayName: "GitHub Identity",
      connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      createConnection: false,
    });

    const response = await fixture.request("/v1/me/linked-accounts/github", {
      method: "POST",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const payload = StartLinkedAccountAuthorizationResponseSchema.parse(await response.json());
    const authorizationUrl = new URL(payload.authorizationUrl);

    expect(authorizationUrl.origin).toBe("https://github.com");
    expect(authorizationUrl.pathname).toBe("/login/oauth/authorize");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("Iv1.client123");
    expect(authorizationUrl.searchParams.get("state")).toBeTruthy();
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      `${fixture.config.auth.baseUrl}/p/identity-linking/callbacks/github`,
    );
    expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(payload.expiresAt).toBeTruthy();

    const persistedRedirectSession = await fixture.db.query.identityLinkRedirectSessions.findFirst({
      where: (table, { eq }) =>
        eq(table.state, authorizationUrl.searchParams.get("state") ?? "__missing__"),
    });

    expect(persistedRedirectSession?.organizationId).toBe(session.organizationId);
    expect(persistedRedirectSession?.userId).toBe(session.userId);
    expect(persistedRedirectSession?.providerFamily).toBe("github");
    expect(persistedRedirectSession?.integrationConnectionId).toBe(connectionId);
    expect(persistedRedirectSession?.pkceVerifierEncrypted).toBeTruthy();
    expect(persistedRedirectSession?.usedAt).toBeNull();
    expect(
      resolveIdentityLinkRedirectSecret(
        persistedRedirectSession?.pkceVerifierEncrypted ?? null,
        fixture.config.integrations.masterEncryptionKeys,
      ),
    ).toBeTruthy();
    expect(
      resolveIdentityLinkRedirectSecret(
        persistedRedirectSession?.pkceVerifierEncrypted ?? null,
        fixture.config.integrations.masterEncryptionKeys,
      ),
    ).not.toBe(authorizationUrl.searchParams.get("state"));
  });

  it("fails explicitly when a GitHub identity-linking connection is missing the client secret", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "me-linked-accounts-start-missing-client-secret@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    await insertIdentityLinkProviderConfig({
      fixture,
      organizationId: session.organizationId,
      userId: session.userId,
      configId: "ilp_github_missing_client_secret",
      providerFamily: "github",
      targetKey: "github-cloud",
      connectionId: "icn_github_missing_client_secret",
      connectionDisplayName: "GitHub Missing Client Secret",
      connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      connectionConfig: {
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
      },
    });

    const response = await fixture.request("/v1/me/linked-accounts/github", {
      method: "POST",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_PROVIDER_CONFIG_INPUT",
      message:
        "Integration connection 'icn_github_missing_client_secret' is missing required linked-user authorization configuration for identity linking.",
    });

    const persistedRedirectSession = await fixture.db.query.identityLinkRedirectSessions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, session.organizationId),
    });
    expect(persistedRedirectSession).toBeUndefined();
  });

  it("starts Slack linked-account authorization and persists redirect session state", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "me-linked-accounts-start-slack@example.com",
    });

    await upsertSlackTarget({
      fixture,
      targetKey: "slack-default",
    });
    const connectionId = await createSlackAppConnection({
      fixture,
      authenticatedSession: session,
      displayName: "Slack Identity",
    });
    await insertIdentityLinkProviderConfig({
      fixture,
      organizationId: session.organizationId,
      userId: session.userId,
      configId: "ilp_slack_start",
      providerFamily: "slack",
      targetKey: "slack-default",
      connectionId,
      connectionDisplayName: "Slack Identity",
      connectionMethodId: SlackConnectionMethodIds.SLACK_APP,
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      createConnection: false,
    });

    const response = await fixture.request("/v1/me/linked-accounts/slack", {
      method: "POST",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const payload = StartLinkedAccountAuthorizationResponseSchema.parse(await response.json());
    const authorizationUrl = new URL(payload.authorizationUrl);

    expect(authorizationUrl.origin).toBe("https://slack.com");
    expect(authorizationUrl.pathname).toBe("/oauth/v2/authorize");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("123.456");
    expect(authorizationUrl.searchParams.get("user_scope")).toBe(
      "users.profile:read,users:read.email",
    );
    expect(authorizationUrl.searchParams.get("state")).toBeTruthy();
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      `${fixture.config.auth.baseUrl}/p/identity-linking/callbacks/slack`,
    );
    expect(payload.expiresAt).toBeTruthy();

    const persistedRedirectSession = await fixture.db.query.identityLinkRedirectSessions.findFirst({
      where: (table, { eq }) =>
        eq(table.state, authorizationUrl.searchParams.get("state") ?? "__missing__"),
    });
    expect(persistedRedirectSession?.organizationId).toBe(session.organizationId);
    expect(persistedRedirectSession?.userId).toBe(session.userId);
    expect(persistedRedirectSession?.providerFamily).toBe("slack");
    expect(persistedRedirectSession?.integrationConnectionId).toBe(connectionId);
    expect(persistedRedirectSession?.pkceVerifierEncrypted).toBeNull();
    expect(persistedRedirectSession?.usedAt).toBeNull();
  });

  it("persists encrypted linked-account redirect session state", async ({ fixture }) => {
    const session = await fixture.authSession({
      email: "me-linked-accounts-redirect-session@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    await insertIdentityLinkProviderConfig({
      fixture,
      organizationId: session.organizationId,
      userId: session.userId,
      configId: "ilp_redirect_session",
      providerFamily: "github",
      targetKey: "github-cloud",
      connectionId: "icn_redirect_session",
      connectionDisplayName: "GitHub Redirect Session",
      connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    });

    const masterKeyVersion = fixture.config.integrations.activeMasterEncryptionKeyVersion;
    const masterEncryptionKeyMaterial =
      fixture.config.integrations.masterEncryptionKeys[String(masterKeyVersion)];
    if (masterEncryptionKeyMaterial === undefined) {
      throw new Error(`Missing integration master key version '${String(masterKeyVersion)}'.`);
    }

    await persistIdentityLinkRedirectSession({
      db: fixture.db,
      organizationId: session.organizationId,
      userId: session.userId,
      providerFamily: "github",
      organizationProviderConfigId: "ilp_redirect_session",
      integrationConnectionId: "icn_redirect_session",
      state: "state-created",
      pkceVerifier: "pkce-verifier",
      providerState: {
        installationId: "12345",
      },
      expiresAt: "2030-04-19T00:00:00.000Z",
      masterKeyVersion,
      masterEncryptionKeyMaterial,
    });

    const redirectSession = await fixture.db.query.identityLinkRedirectSessions.findFirst({
      where: (table, { eq }) => eq(table.state, "state-created"),
    });

    expect(redirectSession).toMatchObject({
      organizationId: session.organizationId,
      userId: session.userId,
      providerFamily: "github",
      organizationProviderConfigId: "ilp_redirect_session",
      integrationConnectionId: "icn_redirect_session",
      state: "state-created",
      usedAt: null,
    });
    expect(Date.parse(redirectSession?.expiresAt ?? "")).toBe(
      Date.parse("2030-04-19T00:00:00.000Z"),
    );
    expect(redirectSession?.pkceVerifierEncrypted).toBeTruthy();
    expect(redirectSession?.providerStateEncrypted).toBeTruthy();
    expect(
      resolveIdentityLinkRedirectSecret(
        redirectSession?.pkceVerifierEncrypted ?? null,
        fixture.config.integrations.masterEncryptionKeys,
      ),
    ).toBe("pkce-verifier");
    expect(
      resolveIdentityLinkProviderState(
        redirectSession?.providerStateEncrypted ?? null,
        fixture.config.integrations.masterEncryptionKeys,
      ),
    ).toEqual({
      installationId: "12345",
    });
  });

  it("completes the GitHub linked-account callback and persists the principal, keys, and credential", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "me-linked-accounts-callback-success@example.com",
    });
    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const seenRequests: Array<{
      method: string;
      pathname: string;
      search: string;
      body: string;
      authorization?: string;
    }> = [];
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", `http://${host}:${String(port)}`);
      let body = "";
      request.on("data", (chunk) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        seenRequests.push({
          method: request.method ?? "GET",
          pathname: requestUrl.pathname,
          search: requestUrl.search,
          body,
          ...(typeof request.headers.authorization === "string"
            ? { authorization: request.headers.authorization }
            : {}),
        });

        response.setHeader("content-type", "application/json");

        if (requestUrl.pathname === "/login/oauth/access_token") {
          response.end(
            JSON.stringify({
              access_token: "ghu_user_token",
              expires_in: 28800,
              refresh_token: "ghr_refresh_token",
              refresh_token_expires_in: 15897600,
              scope: "pull_requests:write,repo",
              token_type: "bearer",
            }),
          );
          return;
        }

        if (requestUrl.pathname === "/user") {
          response.end(
            JSON.stringify({
              id: 12345,
              login: "mistle-user",
              name: "Mistle User",
              email: null,
              avatar_url: "https://avatars.example.com/u/12345",
            }),
          );
          return;
        }

        if (requestUrl.pathname === "/user/emails") {
          response.end(
            JSON.stringify([
              {
                email: "mistle-user@example.com",
                primary: true,
                verified: true,
              },
            ]),
          );
          return;
        }

        response.statusCode = 404;
        response.end(JSON.stringify({ message: "Not found." }));
      });
    });
    server.listen(port, host);
    await once(server, "listening");

    try {
      const baseUrl = `http://${host}:${String(port)}`;
      await upsertGitHubTarget({
        fixture,
        targetKey: "github-cloud",
        apiBaseUrl: baseUrl,
        webBaseUrl: baseUrl,
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
        configId: "ilp_github_callback_success",
        providerFamily: "github",
        targetKey: "github-cloud",
        connectionId,
        connectionDisplayName: "GitHub Identity",
        connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        createConnection: false,
      });

      const startResponse = await fixture.request("/v1/me/linked-accounts/github", {
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
      expect(state).toBeTruthy();

      const redirectSession = await fixture.db.query.identityLinkRedirectSessions.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, session.organizationId),
            eq(table.providerFamily, "github"),
            eq(table.state, state ?? "__missing__"),
          ),
      });
      const pkceVerifier = resolveIdentityLinkRedirectSecret(
        redirectSession?.pkceVerifierEncrypted ?? null,
        fixture.config.integrations.masterEncryptionKeys,
      );
      expect(pkceVerifier).toBeTruthy();
      expect(pkceVerifier).not.toBe(state);

      const callbackResponse = await fixture.request(
        `/p/identity-linking/callbacks/github?state=${encodeURIComponent(state ?? "__missing__")}&code=code_123`,
        {
          redirect: "manual",
        },
      );

      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.headers.get("location")).toBe(
        "http://localhost:5173/settings/account/profile?linkedAccountProvider=github&linkedAccountResult=success",
      );

      expect(seenRequests).toEqual([
        {
          method: "POST",
          pathname: "/login/oauth/access_token",
          search: `?client_id=Iv1.client123&client_secret=github-client-secret&code=code_123&redirect_uri=${encodeURIComponent(`${fixture.config.auth.baseUrl}/p/identity-linking/callbacks/github`)}&code_verifier=${encodeURIComponent(pkceVerifier ?? "")}`,
          body: "",
        },
        {
          method: "GET",
          pathname: "/user",
          search: "",
          body: "",
          authorization: "Bearer ghu_user_token",
        },
        {
          method: "GET",
          pathname: "/user/emails",
          search: "",
          body: "",
          authorization: "Bearer ghu_user_token",
        },
      ]);

      const principal = await fixture.db.query.userExternalPrincipals.findFirst({
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
        organizationProviderConfigId: "ilp_github_callback_success",
        integrationConnectionId: connectionId,
        status: UserExternalPrincipalStatuses.ACTIVE,
        profile: {
          login: "mistle-user",
          displayName: "Mistle User",
          avatarUrl: "https://avatars.example.com/u/12345",
          email: "mistle-user@example.com",
        },
      });
      expect(principal?.linkedAt).toBeTruthy();

      const keys = await fixture.db.query.userExternalPrincipalKeys.findMany({
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

      const credential = await fixture.db.query.userExternalPrincipalCredentials.findFirst({
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

      const credentialSecrets =
        await fixture.db.query.userExternalPrincipalCredentialSecrets.findMany({
          columns: {
            secretKind: true,
            nonce: true,
            ciphertext: true,
            organizationCredentialKeyVersion: true,
          },
          where: (table, { and, eq }) =>
            and(
              eq(table.organizationId, session.organizationId),
              eq(table.credentialId, credential?.id ?? "__missing__"),
            ),
          orderBy: (table, { asc }) => [asc(table.secretKind)],
        });
      expect(credentialSecrets.map((secret) => secret.secretKind)).toEqual([
        UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
        UserExternalPrincipalCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
      ]);
      expect(
        await decryptUserExternalPrincipalCredentialSecret({
          fixture,
          organizationCredentialKeyVersion:
            credentialSecrets[0]?.organizationCredentialKeyVersion ?? -1,
          nonce: credentialSecrets[0]?.nonce ?? "__missing__",
          ciphertext: credentialSecrets[0]?.ciphertext ?? "__missing__",
          organizationId: session.organizationId,
        }),
      ).toBe("ghu_user_token");
      expect(
        await decryptUserExternalPrincipalCredentialSecret({
          fixture,
          organizationCredentialKeyVersion:
            credentialSecrets[1]?.organizationCredentialKeyVersion ?? -1,
          nonce: credentialSecrets[1]?.nonce ?? "__missing__",
          ciphertext: credentialSecrets[1]?.ciphertext ?? "__missing__",
          organizationId: session.organizationId,
        }),
      ).toBe("ghr_refresh_token");

      const consumedRedirectSession = await fixture.db.query.identityLinkRedirectSessions.findFirst(
        {
          where: (table, { and, eq }) =>
            and(
              eq(table.organizationId, session.organizationId),
              eq(table.providerFamily, "github"),
              eq(table.state, state ?? "__missing__"),
            ),
        },
      );
      expect(consumedRedirectSession?.usedAt).toBeTruthy();
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("completes the Slack linked-account callback and persists the principal and user token when no refresh token is returned", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "me-linked-accounts-callback-slack-success@example.com",
    });
    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const seenRequests: Array<{
      method: string;
      pathname: string;
      search: string;
      body: string;
      authorization?: string;
    }> = [];
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", `http://${host}:${String(port)}`);
      let body = "";
      request.on("data", (chunk) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        seenRequests.push({
          method: request.method ?? "GET",
          pathname: requestUrl.pathname,
          search: requestUrl.search,
          body,
          ...(typeof request.headers.authorization === "string"
            ? { authorization: request.headers.authorization }
            : {}),
        });

        response.setHeader("content-type", "application/json");

        if (requestUrl.pathname === "/api/oauth.v2.access") {
          response.end(
            JSON.stringify({
              ok: true,
              team: {
                id: "T12345",
                name: "Mistle Engineering",
              },
              authed_user: {
                id: "U12345",
                scope: "users.profile:read,users:read.email",
                access_token: "xoxe.xoxp-slack-user-token",
                expires_in: 43200,
                token_type: "user",
              },
            }),
          );
          return;
        }

        if (requestUrl.pathname === "/api/users.profile.get") {
          response.end(
            JSON.stringify({
              ok: true,
              profile: {
                display_name: "Mistle Slack User",
                real_name: "Mistle Slack User Real",
                image_192: "https://avatars.slack-edge.com/u12345.png",
                email: "mistle-slack-user@example.com",
              },
            }),
          );
          return;
        }

        response.statusCode = 404;
        response.end(JSON.stringify({ ok: false, error: "not_found" }));
      });
    });
    server.listen(port, host);
    await once(server, "listening");

    try {
      const apiBaseUrl = `http://${host}:${String(port)}/api`;
      await upsertSlackTarget({
        fixture,
        targetKey: "slack-default",
        apiBaseUrl,
      });
      const connectionId = await createSlackAppConnection({
        fixture,
        authenticatedSession: session,
        displayName: "Slack Identity",
      });
      await insertIdentityLinkProviderConfig({
        fixture,
        organizationId: session.organizationId,
        userId: session.userId,
        configId: "ilp_slack_callback_success",
        providerFamily: "slack",
        targetKey: "slack-default",
        connectionId,
        connectionDisplayName: "Slack Identity",
        connectionMethodId: SlackConnectionMethodIds.SLACK_APP,
        configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        createConnection: false,
      });

      const startResponse = await fixture.request("/v1/me/linked-accounts/slack", {
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
      expect(state).toBeTruthy();

      const callbackResponse = await fixture.request(
        `/p/identity-linking/callbacks/slack?state=${encodeURIComponent(state ?? "__missing__")}&code=code_123`,
        {
          redirect: "manual",
        },
      );

      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.headers.get("location")).toBe(
        "http://localhost:5173/settings/account/profile?linkedAccountProvider=slack&linkedAccountResult=success",
      );

      expect(seenRequests).toEqual([
        {
          method: "POST",
          pathname: "/api/oauth.v2.access",
          search: "",
          body: `client_id=123.456&client_secret=slack-client-secret&code=code_123&redirect_uri=${encodeURIComponent(`${fixture.config.auth.baseUrl}/p/identity-linking/callbacks/slack`)}`,
        },
        {
          method: "GET",
          pathname: "/api/users.profile.get",
          search: "?user=U12345",
          body: "",
          authorization: "Bearer xoxe.xoxp-slack-user-token",
        },
      ]);

      const principal = await fixture.db.query.userExternalPrincipals.findFirst({
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
        organizationProviderConfigId: "ilp_slack_callback_success",
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

      const keys = await fixture.db.query.userExternalPrincipalKeys.findMany({
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

      const credential = await fixture.db.query.userExternalPrincipalCredentials.findFirst({
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
        scopes: ["users.profile:read", "users:read.email"],
      });
      expect(credential?.accessTokenExpiresAt).toBeTruthy();
      expect(credential?.refreshTokenExpiresAt).toBeNull();

      const credentialSecrets =
        await fixture.db.query.userExternalPrincipalCredentialSecrets.findMany({
          columns: {
            secretKind: true,
            nonce: true,
            ciphertext: true,
            organizationCredentialKeyVersion: true,
          },
          where: (table, { and, eq }) =>
            and(
              eq(table.organizationId, session.organizationId),
              eq(table.credentialId, credential?.id ?? "__missing__"),
            ),
          orderBy: (table, { asc }) => [asc(table.secretKind)],
        });
      expect(credentialSecrets.map((secret) => secret.secretKind)).toEqual([
        UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
      ]);
      expect(
        await decryptUserExternalPrincipalCredentialSecret({
          fixture,
          organizationCredentialKeyVersion:
            credentialSecrets[0]?.organizationCredentialKeyVersion ?? -1,
          nonce: credentialSecrets[0]?.nonce ?? "__missing__",
          ciphertext: credentialSecrets[0]?.ciphertext ?? "__missing__",
          organizationId: session.organizationId,
        }),
      ).toBe("xoxe.xoxp-slack-user-token");
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("redirects with failure details when the linked-account callback state does not exist", async ({
    fixture,
  }) => {
    const response = await fixture.request(
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

  it("redirects with failure details when the linked-account callback state has expired", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "me-linked-accounts-callback-expired@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    await insertIdentityLinkProviderConfig({
      fixture,
      organizationId: session.organizationId,
      userId: session.userId,
      configId: "ilp_github_expired",
      providerFamily: "github",
      targetKey: "github-cloud",
      connectionId: "icn_github_expired",
      connectionDisplayName: "GitHub Expired",
      connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    });
    await fixture.db.insert(identityLinkRedirectSessions).values({
      id: "ilr_expired",
      organizationId: session.organizationId,
      userId: session.userId,
      providerFamily: "github",
      organizationProviderConfigId: "ilp_github_expired",
      integrationConnectionId: "icn_github_expired",
      state: "state-expired",
      expiresAt: "2020-04-18T00:00:00.000Z",
    });

    const response = await fixture.request(
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

  it("redirects with failure details when the linked-account callback state was already consumed", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "me-linked-accounts-callback-used@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    await insertIdentityLinkProviderConfig({
      fixture,
      organizationId: session.organizationId,
      userId: session.userId,
      configId: "ilp_github_used",
      providerFamily: "github",
      targetKey: "github-cloud",
      connectionId: "icn_github_used",
      connectionDisplayName: "GitHub Used",
      connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    });
    await fixture.db.insert(identityLinkRedirectSessions).values({
      id: "ilr_used",
      organizationId: session.organizationId,
      userId: session.userId,
      providerFamily: "github",
      organizationProviderConfigId: "ilp_github_used",
      integrationConnectionId: "icn_github_used",
      state: "state-used",
      expiresAt: "2030-04-19T00:00:00.000Z",
      usedAt: "2026-04-18T10:00:00.000Z",
    });

    const response = await fixture.request(
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

  it("unlinks linked accounts by retiring keys and revoking credentials", async ({ fixture }) => {
    const session = await fixture.authSession({
      email: "me-linked-accounts-unlink@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    await insertIdentityLinkProviderConfig({
      fixture,
      organizationId: session.organizationId,
      userId: session.userId,
      configId: "ilp_github_unlink",
      providerFamily: "github",
      targetKey: "github-cloud",
      connectionId: "icn_github_unlink",
      connectionDisplayName: "GitHub Unlink",
      connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    });
    await fixture.db.insert(userExternalPrincipals).values({
      id: "uep_unlink",
      organizationId: session.organizationId,
      userId: session.userId,
      providerFamily: "github",
      providerSubjectId: "unlink-subject",
      organizationProviderConfigId: "ilp_github_unlink",
      integrationConnectionId: "icn_github_unlink",
      status: UserExternalPrincipalStatuses.ACTIVE,
    });
    await fixture.db.insert(userExternalPrincipalKeys).values({
      organizationId: session.organizationId,
      principalId: "uep_unlink",
      providerFamily: "github",
      keyType: "account_id",
      keyValue: "unlink-subject",
      status: UserExternalPrincipalKeyStatuses.ACTIVE,
    });
    await fixture.db.insert(userExternalPrincipalCredentials).values({
      id: "upc_unlink",
      organizationId: session.organizationId,
      principalId: "uep_unlink",
      providerFamily: "github",
      credentialKind: "github_app_user_access_token",
      status: UserExternalPrincipalCredentialStatuses.ACTIVE,
    });

    const response = await fixture.request("/v1/me/linked-accounts/github", {
      method: "DELETE",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(204);

    const principal = await fixture.db.query.userExternalPrincipals.findFirst({
      where: (table, { eq }) => eq(table.id, "uep_unlink"),
    });
    const key = await fixture.db.query.userExternalPrincipalKeys.findFirst({
      where: (table, { eq }) => eq(table.principalId, "uep_unlink"),
    });
    const credential = await fixture.db.query.userExternalPrincipalCredentials.findFirst({
      where: (table, { eq }) => eq(table.id, "upc_unlink"),
    });

    expect(principal?.status).toBe(UserExternalPrincipalStatuses.UNLINKED);
    expect(principal?.unlinkedAt).toBeTruthy();
    expect(key?.status).toBe(UserExternalPrincipalKeyStatuses.RETIRED);
    expect(key?.retiredAt).toBeTruthy();
    expect(credential?.status).toBe(UserExternalPrincipalCredentialStatuses.REVOKED);
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

async function upsertSlackTarget(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  targetKey: string;
  apiBaseUrl?: string;
}): Promise<void> {
  const apiBaseUrl = input.apiBaseUrl ?? "https://slack.com/api";

  await input.fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "slack",
      variantId: "slack-default",
      enabled: true,
      config: {
        api_base_url: apiBaseUrl,
      },
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          api_base_url: apiBaseUrl,
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

async function createSlackAppConnection(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  authenticatedSession: Awaited<ReturnType<ControlPlaneApiIntegrationFixture["authSession"]>>;
  displayName: string;
}): Promise<string> {
  const response = await input.fixture.request("/v1/integration/connections/slack-default/form", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: input.authenticatedSession.cookie,
    },
    body: JSON.stringify({
      displayName: input.displayName,
      methodId: SlackConnectionMethodIds.SLACK_APP,
      config: {
        connection_method: SlackConnectionMethodIds.SLACK_APP,
        client_id: "123.456",
      },
      secrets: {
        botToken: "xoxb-slack-bot-token",
        signingSecret: "slack-signing-secret",
        clientSecret: "slack-client-secret",
      },
    }),
  });

  expect(response.status).toBe(201);
  const createdConnection = await response.json();
  if (typeof createdConnection !== "object" || createdConnection === null) {
    throw new Error("Expected Slack App OAuth connection create response object.");
  }

  const connectionId = createdConnection["id"];
  if (typeof connectionId !== "string" || connectionId.length === 0) {
    throw new Error("Expected Slack App OAuth connection id.");
  }

  return connectionId;
}

async function decryptUserExternalPrincipalCredentialSecret(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  organizationCredentialKeyVersion: number;
  nonce: string;
  ciphertext: string;
}): Promise<string> {
  const organizationCredentialKey =
    await input.fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, input.organizationId),
          eq(table.version, input.organizationCredentialKeyVersion),
        ),
    });
  if (organizationCredentialKey === undefined) {
    throw new Error("Expected organization credential key.");
  }

  const masterKeyMaterial =
    input.fixture.config.integrations.masterEncryptionKeys[
      String(organizationCredentialKey.masterKeyVersion)
    ];
  if (masterKeyMaterial === undefined) {
    throw new Error(
      `Missing integration master key version '${String(organizationCredentialKey.masterKeyVersion)}'.`,
    );
  }

  const organizationCredentialKeyMaterial = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial: masterKeyMaterial,
  });

  try {
    return decryptCredentialUtf8({
      nonce: input.nonce,
      ciphertext: input.ciphertext,
      organizationCredentialKey: organizationCredentialKeyMaterial,
    });
  } finally {
    organizationCredentialKeyMaterial.fill(0);
  }
}
