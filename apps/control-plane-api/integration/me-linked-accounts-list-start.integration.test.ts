/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalCredentialStatuses,
  UserExternalPrincipalStatuses,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { SlackConnectionMethodIds } from "@mistle/integrations-definitions";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  LinkedAccountsResponseSchema,
  StartLinkedAccountAuthorizationResponseSchema,
} from "../src/me/index.js";
import {
  createGitHubIdentityConnection,
  createSlackIdentityConnection,
  seedGitHubLinkedPrincipal,
  seedIdentityConnection,
  seedIdentityProviderConfig,
  seedPrincipalCredential,
  upsertGitHubIdentityTarget,
  upsertSlackIdentityTarget,
} from "./helpers/identity-linking.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("me linked accounts list and start integration", () => {
  it("lists configured providers with current-user principal and credential summaries", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-list@example.com",
    });
    await upsertGitHubIdentityTarget(env);
    await upsertSlackIdentityTarget(env);
    await seedIdentityConnection(env, {
      connectionId: "icn_me_linked_accounts_github_identity",
      displayName: "GitHub Identity",
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      organizationId: session.organizationId,
      targetKey: "github-cloud",
    });
    await seedIdentityConnection(env, {
      connectionId: "icn_me_linked_accounts_slack_identity",
      displayName: "Slack Identity",
      methodId: SlackConnectionMethodIds.SLACK_APP,
      organizationId: session.organizationId,
      targetKey: "slack-default",
    });
    await seedIdentityProviderConfig(env, {
      configId: "ilp_me_linked_accounts_github",
      connectionId: "icn_me_linked_accounts_github_identity",
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      targetKey: "github-cloud",
      userId: session.userId,
    });
    await seedIdentityProviderConfig(env, {
      configId: "ilp_me_linked_accounts_slack",
      connectionId: "icn_me_linked_accounts_slack_identity",
      organizationId: session.organizationId,
      providerFamily: "slack",
      status: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
      targetKey: "slack-default",
      userId: session.userId,
    });
    await seedGitHubLinkedPrincipal(env, {
      organizationId: session.organizationId,
      userId: session.userId,
      principalId: "uep_me_linked_accounts_github",
      providerConfigId: "ilp_me_linked_accounts_github",
      connectionId: "icn_me_linked_accounts_github_identity",
      profile: {
        login: "mistle-user",
      },
    });
    await seedPrincipalCredential(env, {
      credentialId: "upc_me_linked_accounts_github",
      organizationId: session.organizationId,
      principalId: "uep_me_linked_accounts_github",
      providerFamily: "github",
      credentialKind: "github_app_user_access_token",
      accessTokenExpiresAt: "2026-04-18T12:00:00.000Z",
      refreshTokenExpiresAt: "2026-10-18T12:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/me/linked-accounts", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const payload = LinkedAccountsResponseSchema.parse(await response.json());
    expect(payload.linkedAccounts).toHaveLength(2);
    expect(payload.linkedAccounts[0]).toMatchObject({
      providerFamily: "github",
      organizationProviderConfigId: "ilp_me_linked_accounts_github",
      integrationConnectionId: "icn_me_linked_accounts_github_identity",
      displayName: "GitHub",
      logoKey: "github",
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      principal: {
        id: "uep_me_linked_accounts_github",
        status: UserExternalPrincipalStatuses.ACTIVE,
        providerSubjectId: "12345",
        profile: {
          login: "mistle-user",
        },
      },
      credential: {
        id: "upc_me_linked_accounts_github",
        credentialKind: "github_app_user_access_token",
        status: UserExternalPrincipalCredentialStatuses.ACTIVE,
      },
      commitSigning: null,
    });
    expect(payload.linkedAccounts[1]).toMatchObject({
      providerFamily: "slack",
      organizationProviderConfigId: "ilp_me_linked_accounts_slack",
      integrationConnectionId: "icn_me_linked_accounts_slack_identity",
      displayName: "Slack",
      logoKey: "slack",
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
      principal: null,
      credential: null,
      commitSigning: null,
    });
  });

  it("starts GitHub linked-account authorization and persists encrypted redirect state", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-start-github@example.com",
    });
    await upsertGitHubIdentityTarget(env);
    const connectionId = await createGitHubIdentityConnection(env, {
      displayName: "GitHub Identity",
      session,
    });
    await seedIdentityProviderConfig(env, {
      configId: "ilp_me_linked_accounts_start_github",
      connectionId,
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      targetKey: "github-cloud",
      userId: session.userId,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/me/linked-accounts/github", {
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
    expect(authorizationUrl.searchParams.get("redirect_uri")).toMatch(
      /\/p\/identity-linking\/callbacks\/github$/u,
    );
    expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(payload.expiresAt).toBeTruthy();

    const persistedRedirectSession =
      await env.controlPlaneDb.query.identityLinkRedirectSessions.findFirst({
        where: (table, { eq }) =>
          eq(table.state, authorizationUrl.searchParams.get("state") ?? "__missing__"),
      });
    expect(persistedRedirectSession).toMatchObject({
      organizationId: session.organizationId,
      userId: session.userId,
      providerFamily: "github",
      integrationConnectionId: connectionId,
      usedAt: null,
    });
    expect(persistedRedirectSession?.pkceVerifierEncrypted).toBeTruthy();
  });

  it("starts Slack linked-account authorization without PKCE redirect state", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-start-slack@example.com",
    });
    await upsertSlackIdentityTarget(env);
    const connectionId = await createSlackIdentityConnection(env, {
      displayName: "Slack Identity",
      session,
    });
    await seedIdentityProviderConfig(env, {
      configId: "ilp_me_linked_accounts_start_slack",
      connectionId,
      organizationId: session.organizationId,
      providerFamily: "slack",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      targetKey: "slack-default",
      userId: session.userId,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/me/linked-accounts/slack", {
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
      "users.profile:read,users:read,users:read.email",
    );

    const persistedRedirectSession =
      await env.controlPlaneDb.query.identityLinkRedirectSessions.findFirst({
        where: (table, { eq }) =>
          eq(table.state, authorizationUrl.searchParams.get("state") ?? "__missing__"),
      });
    expect(persistedRedirectSession?.providerFamily).toBe("slack");
    expect(persistedRedirectSession?.integrationConnectionId).toBe(connectionId);
    expect(persistedRedirectSession?.pkceVerifierEncrypted).toBeNull();
  });

  it("rejects starting authorization when no active provider config exists", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-start-no-config@example.com",
    });
    await upsertGitHubIdentityTarget(env);

    const response = await env.controlPlaneApi.http.fetch("/v1/me/linked-accounts/github", {
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

  it("fails explicitly when a GitHub identity connection is missing the client secret", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-start-missing-client-secret@example.com",
    });
    await upsertGitHubIdentityTarget(env);
    await seedIdentityConnection(env, {
      connectionId: "icn_me_linked_accounts_missing_client_secret",
      displayName: "GitHub Missing Client Secret",
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      organizationId: session.organizationId,
      targetKey: "github-cloud",
      config: {
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
      },
    });
    await seedIdentityProviderConfig(env, {
      configId: "ilp_me_linked_accounts_missing_client_secret",
      connectionId: "icn_me_linked_accounts_missing_client_secret",
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      targetKey: "github-cloud",
      userId: session.userId,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/me/linked-accounts/github", {
      method: "POST",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_PROVIDER_CONFIG_INPUT",
      message:
        "Integration connection 'icn_me_linked_accounts_missing_client_secret' is missing required linked-user authorization configuration for identity linking.",
    });
  });
});
