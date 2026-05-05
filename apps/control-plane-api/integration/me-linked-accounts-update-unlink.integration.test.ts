/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  OrganizationIdentityLinkProviderConfigStatus,
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

import {
  seedGitHubLinkedPrincipal,
  seedIdentityConnection,
  seedIdentityProviderConfig,
  seedPrincipalCredential,
  upsertGitHubIdentityTarget,
} from "./helpers/identity-linking.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("me linked accounts update and unlink integration", () => {
  it("updates the preferred email for an existing GitHub linked account", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-preferred-email@example.com",
    });
    await seedGitHubLinkedAccount(env, {
      organizationId: session.organizationId,
      userId: session.userId,
      providerConfigId: "ilp_me_linked_accounts_preferred_email",
      connectionId: "icn_me_linked_accounts_preferred_email",
      principalId: "uep_me_linked_accounts_preferred_email",
      profile: {
        login: "mistle-user",
        preferredEmail: "mistle-user@example.com",
        availableEmails: [
          {
            email: "mistle-user@example.com",
            primary: true,
            verified: true,
          },
          {
            email: "engineering@example.com",
            primary: false,
            verified: true,
          },
        ],
      },
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/me/linked-accounts/github/preferred-email",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          preferredEmail: "engineering@example.com",
        }),
      },
    );

    expect(response.status).toBe(204);
    const updatedPrincipal = await env.controlPlaneDb.query.userExternalPrincipals.findFirst({
      where: (table, { eq }) => eq(table.id, "uep_me_linked_accounts_preferred_email"),
    });
    expect(updatedPrincipal?.profile).toEqual({
      login: "mistle-user",
      preferredEmail: "engineering@example.com",
      availableEmails: [
        {
          email: "mistle-user@example.com",
          primary: true,
          verified: true,
        },
        {
          email: "engineering@example.com",
          primary: false,
          verified: true,
        },
      ],
    });
  });

  it("rejects preferred email updates when the linked account has no selectable emails", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-preferred-email-unselectable@example.com",
    });
    await seedGitHubLinkedAccount(env, {
      organizationId: session.organizationId,
      userId: session.userId,
      providerConfigId: "ilp_me_linked_accounts_preferred_email_unselectable",
      connectionId: "icn_me_linked_accounts_preferred_email_unselectable",
      principalId: "uep_me_linked_accounts_preferred_email_unselectable",
      profile: {
        login: "mistle-user",
        preferredEmail: "mistle-user@example.com",
        availableEmails: [],
      },
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/me/linked-accounts/github/preferred-email",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          preferredEmail: "engineering@example.com",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_LINKED_ACCOUNT_PREFERRED_EMAIL_INPUT",
      message: "GitHub linked account does not have selectable emails.",
    });
  });

  it("unlinks a linked account by retiring keys and revoking credentials", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-unlink@example.com",
    });
    await seedGitHubLinkedAccount(env, {
      organizationId: session.organizationId,
      userId: session.userId,
      providerConfigId: "ilp_me_linked_accounts_unlink",
      connectionId: "icn_me_linked_accounts_unlink",
      principalId: "uep_me_linked_accounts_unlink",
      providerSubjectId: "unlink-subject",
    });
    await seedPrincipalCredential(env, {
      credentialId: "upc_me_linked_accounts_unlink",
      organizationId: session.organizationId,
      principalId: "uep_me_linked_accounts_unlink",
      providerFamily: "github",
      credentialKind: "github_app_user_access_token",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/me/linked-accounts/github", {
      method: "DELETE",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(204);
    const principal = await env.controlPlaneDb.query.userExternalPrincipals.findFirst({
      where: (table, { eq }) => eq(table.id, "uep_me_linked_accounts_unlink"),
    });
    const key = await env.controlPlaneDb.query.userExternalPrincipalKeys.findFirst({
      where: (table, { eq }) => eq(table.principalId, "uep_me_linked_accounts_unlink"),
    });
    const credential = await env.controlPlaneDb.query.userExternalPrincipalCredentials.findFirst({
      where: (table, { eq }) => eq(table.id, "upc_me_linked_accounts_unlink"),
    });
    expect(principal?.status).toBe(UserExternalPrincipalStatuses.UNLINKED);
    expect(principal?.unlinkedAt).toBeTruthy();
    expect(key?.status).toBe(UserExternalPrincipalKeyStatuses.RETIRED);
    expect(key?.retiredAt).toBeTruthy();
    expect(credential?.status).toBe(UserExternalPrincipalCredentialStatuses.REVOKED);
  });
});

async function seedGitHubLinkedAccount(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    userId: string;
    providerConfigId: string;
    connectionId: string;
    principalId: string;
    providerSubjectId?: string;
    profile?: Record<string, unknown>;
  },
): Promise<void> {
  await upsertGitHubIdentityTarget(env);
  await seedIdentityConnection(env, {
    connectionId: input.connectionId,
    displayName: "GitHub Identity",
    methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    organizationId: input.organizationId,
    targetKey: "github-cloud",
  });
  await seedIdentityProviderConfig(env, {
    configId: input.providerConfigId,
    connectionId: input.connectionId,
    organizationId: input.organizationId,
    providerFamily: "github",
    status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    targetKey: "github-cloud",
    userId: input.userId,
  });
  await seedGitHubLinkedPrincipal(env, {
    organizationId: input.organizationId,
    userId: input.userId,
    principalId: input.principalId,
    providerConfigId: input.providerConfigId,
    connectionId: input.connectionId,
    ...(input.providerSubjectId === undefined
      ? {}
      : { providerSubjectId: input.providerSubjectId }),
    ...(input.profile === undefined ? {} : { profile: input.profile }),
  });
}
