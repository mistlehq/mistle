import {
  identityLinkRedirectSessions,
  integrationConnections,
  integrationTargets,
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
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
import { describe, expect } from "vitest";

import {
  persistIdentityLinkRedirectSession,
  resolveIdentityLinkProviderState,
  resolveIdentityLinkRedirectSecret,
} from "../src/identity-linking/services/redirect-flow.js";
import { LinkedAccountsResponseSchema } from "../src/me/index.js";
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
      connectionMethodId: SlackConnectionMethodIds.SLACK_BOT_TOKEN,
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

  it("fails explicitly when the provider adapter is not implemented and does not persist a redirect session", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "me-linked-accounts-start-unimplemented@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    await insertIdentityLinkProviderConfig({
      fixture,
      organizationId: session.organizationId,
      userId: session.userId,
      configId: "ilp_github_start",
      providerFamily: "github",
      targetKey: "github-cloud",
      connectionId: "icn_github_start",
      connectionDisplayName: "GitHub Start",
      connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    });

    const response = await fixture.request("/v1/me/linked-accounts/github", {
      method: "POST",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "PROVIDER_ADAPTER_NOT_IMPLEMENTED",
      message:
        "Identity-linking provider 'github' does not yet support linked-account authorization.",
    });

    const persistedRedirectSession = await fixture.db.query.identityLinkRedirectSessions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, session.organizationId),
    });
    expect(persistedRedirectSession).toBeUndefined();
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
}): Promise<void> {
  await input.fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      },
    });
}

async function upsertSlackTarget(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  targetKey: string;
}): Promise<void> {
  await input.fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "slack",
      variantId: "slack-default",
      enabled: true,
      config: {
        api_base_url: "https://slack.com/api",
      },
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          api_base_url: "https://slack.com/api",
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
}): Promise<void> {
  await input.fixture.db.insert(integrationConnections).values({
    id: input.connectionId,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    displayName: input.connectionDisplayName,
    status: IntegrationConnectionStatuses.ACTIVE,
    config: {
      connection_method: input.connectionMethodId,
    },
  });

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
