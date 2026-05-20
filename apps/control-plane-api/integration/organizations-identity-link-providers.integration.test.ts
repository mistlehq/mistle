/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import {
  IntegrationConnectionStatuses,
  type IntegrationConnectionStatus,
  IntegrationCredentialSecretKinds,
  MemberRoles,
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalStatuses,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  SlackConnectionMethodIds,
  SlackCredentialSlotKeys,
} from "@mistle/integrations-definitions";
import {
  createIntegrationTest,
  type IntegrationAuthenticatedSession,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import {
  OrganizationIdentityLinkProviderLinksResponseSchema,
  OrganizationIdentityLinkProviderSchema,
  OrganizationIdentityLinkProvidersResponseSchema,
} from "../src/organizations/schemas.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("organization identity-linking providers integration", () => {
  it("lists supported providers for the active organization with unconfigured status by default", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-identity-link-providers-list@example.com",
    });

    await upsertGitHubTarget(env, "github-cloud");
    await upsertSlackTarget(env, "slack-default");

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/organization/identity-linking/providers",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(response.status).toBe(200);

    const payload = OrganizationIdentityLinkProvidersResponseSchema.parse(await response.json());
    expect(payload.providers).toEqual([
      {
        providerFamily: "github",
        organizationProviderConfigId: null,
        integrationConnectionId: null,
        displayName: "GitHub",
        logoKey: "github",
        eligibleTargetKeys: ["github-cloud"],
        eligibleConnectionMethodIds: [IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION],
        eligibleConnections: [],
        configurationStatus: "unconfigured",
        selectedConnection: null,
        configuredAt: null,
        updatedAt: null,
        configs: [],
      },
      {
        providerFamily: "slack",
        organizationProviderConfigId: null,
        integrationConnectionId: null,
        displayName: "Slack",
        logoKey: "slack",
        eligibleTargetKeys: ["slack-default"],
        eligibleConnectionMethodIds: [SlackConnectionMethodIds.SLACK_APP],
        eligibleConnections: [],
        configurationStatus: "unconfigured",
        selectedConnection: null,
        configuredAt: null,
        updatedAt: null,
        configs: [],
      },
    ]);
  });

  it("saves a GitHub identity-linking provider connection without enabling it", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-identity-link-providers-configure@example.com",
    });
    await upsertGitHubTarget(env, "github-cloud");
    const connectionId = await createGitHubIdentityLinkReadyConnection(env, {
      displayName: "GitHub Identity App",
      session,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/organization/identity-linking/providers/github",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          integrationConnectionId: connectionId,
        }),
      },
    );
    expect(response.status).toBe(200);

    const payload = OrganizationIdentityLinkProviderSchema.parse(await response.json());
    expect(payload.configurationStatus).toBe(OrganizationIdentityLinkProviderConfigStatus.DISABLED);
    expect(payload.organizationProviderConfigId).toBeTruthy();
    expect(payload.integrationConnectionId).toBe(connectionId);
    expect(payload.selectedConnection?.id).toBe(connectionId);
    expect(payload.eligibleConnections.map((connection) => connection.id)).toEqual([connectionId]);

    const persistedConfig =
      await env.controlPlaneDb.query.organizationIdentityLinkProviderConfigs.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.organizationId, session.organizationId), eq(table.providerFamily, "github")),
      });
    expect(persistedConfig).toMatchObject({
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
      integrationTargetKey: "github-cloud",
      integrationConnectionId: connectionId,
      createdByUserId: session.userId,
      updatedByUserId: session.userId,
    });
    expect(payload.organizationProviderConfigId).toBe(persistedConfig?.id);
  });

  it("creates and manages multiple Slack identity-linking configs independently", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-identity-link-providers-multi-slack@example.com",
    });
    await upsertSlackTarget(env, "slack-default");
    await seedSlackIdentityLinkReadyConnection(env, {
      connectionId: "icn_identity_link_slack_workspace_a",
      displayName: "Slack Workspace A",
      organizationId: session.organizationId,
      teamId: "T_WORKSPACE_A",
    });
    await seedSlackIdentityLinkReadyConnection(env, {
      connectionId: "icn_identity_link_slack_workspace_b",
      displayName: "Slack Workspace B",
      organizationId: session.organizationId,
      teamId: "T_WORKSPACE_B",
    });

    const firstCreateResponse = await env.controlPlaneApi.http.fetch(
      "/v1/organization/identity-linking/providers/slack/configs",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          integrationConnectionId: "icn_identity_link_slack_workspace_a",
          status: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
        }),
      },
    );
    expect(firstCreateResponse.status).toBe(201);
    const firstConfig = OrganizationIdentityLinkProviderSchema.shape.configs.element.parse(
      await firstCreateResponse.json(),
    );

    const secondCreateResponse = await env.controlPlaneApi.http.fetch(
      "/v1/organization/identity-linking/providers/slack/configs",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          integrationConnectionId: "icn_identity_link_slack_workspace_b",
          status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        }),
      },
    );
    expect(secondCreateResponse.status).toBe(201);
    const secondConfig = OrganizationIdentityLinkProviderSchema.shape.configs.element.parse(
      await secondCreateResponse.json(),
    );

    const listResponse = await env.controlPlaneApi.http.fetch(
      "/v1/organization/identity-linking/providers",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(listResponse.status).toBe(200);
    const payload = OrganizationIdentityLinkProvidersResponseSchema.parse(
      await listResponse.json(),
    );
    const slackProvider = payload.providers.find((provider) => provider.providerFamily === "slack");
    expect(slackProvider?.configs.map((config) => config.integrationConnectionId).sort()).toEqual([
      "icn_identity_link_slack_workspace_a",
      "icn_identity_link_slack_workspace_b",
    ]);
    expect(
      slackProvider?.configs.find(
        (config) =>
          config.organizationProviderConfigId === firstConfig.organizationProviderConfigId,
      )?.configurationStatus,
    ).toBe(OrganizationIdentityLinkProviderConfigStatus.DISABLED);
    expect(
      slackProvider?.configs.find(
        (config) =>
          config.organizationProviderConfigId === secondConfig.organizationProviderConfigId,
      )?.configurationStatus,
    ).toBe(OrganizationIdentityLinkProviderConfigStatus.ACTIVE);

    const legacyStatusResponse = await env.controlPlaneApi.http.fetch(
      "/v1/organization/identity-linking/providers/slack/status",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          status: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
        }),
      },
    );
    expect(legacyStatusResponse.status).toBe(400);
    await expect(legacyStatusResponse.json()).resolves.toMatchObject({
      code: "PROVIDER_CONFIG_AMBIGUOUS",
    });
  });

  it("enables and disables a saved identity-linking provider without deleting the row", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-identity-link-providers-status@example.com",
    });
    await upsertGitHubTarget(env, "github-cloud");
    const connectionId = await createGitHubIdentityLinkReadyConnection(env, {
      displayName: "GitHub Identity Status",
      session,
    });
    await seedIdentityLinkProviderConfig(env, {
      connectionId,
      organizationId: session.organizationId,
      status: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
      userId: session.userId,
    });

    const enableResponse = await env.controlPlaneApi.http.fetch(
      "/v1/organization/identity-linking/providers/github/status",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        }),
      },
    );
    expect(enableResponse.status).toBe(200);
    const enabledProvider = OrganizationIdentityLinkProviderSchema.parse(
      await enableResponse.json(),
    );
    expect(enabledProvider.configurationStatus).toBe(
      OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    );
    expect(enabledProvider.integrationConnectionId).toBe(connectionId);

    const disableResponse = await env.controlPlaneApi.http.fetch(
      "/v1/organization/identity-linking/providers/github",
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(disableResponse.status).toBe(200);
    const disabledProvider = OrganizationIdentityLinkProviderSchema.parse(
      await disableResponse.json(),
    );
    expect(disabledProvider.configurationStatus).toBe(
      OrganizationIdentityLinkProviderConfigStatus.DISABLED,
    );
    expect(disabledProvider.organizationProviderConfigId).toBeTruthy();
    expect(disabledProvider.integrationConnectionId).toBe(connectionId);
    expect(disabledProvider.selectedConnection?.id).toBe(connectionId);

    const persistedConfig =
      await env.controlPlaneDb.query.organizationIdentityLinkProviderConfigs.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.organizationId, session.organizationId), eq(table.providerFamily, "github")),
      });
    expect(persistedConfig?.status).toBe(OrganizationIdentityLinkProviderConfigStatus.DISABLED);
    expect(persistedConfig?.integrationConnectionId).toBe(connectionId);
  });

  it("rejects invalid or ineligible connections for identity-linking provider configuration", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-identity-link-providers-invalid@example.com",
    });
    await upsertGitHubTarget(env, "github-cloud");
    await seedConnection(env, {
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      connectionId: "icn_integration_new_identity_link_api_key",
      displayName: "GitHub API key",
      organizationId: session.organizationId,
      status: IntegrationConnectionStatuses.ACTIVE,
      targetKey: "github-cloud",
    });
    await seedConnection(env, {
      config: {
        app_id: "12345",
        app_slug: "mistle-github-app",
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      },
      connectionId: "icn_integration_new_identity_link_missing_auth",
      displayName: "GitHub Missing Client Credentials",
      organizationId: session.organizationId,
      status: IntegrationConnectionStatuses.ACTIVE,
      targetKey: "github-cloud",
    });

    const apiKeyResponse = await putProviderConnection(env, {
      connectionId: "icn_integration_new_identity_link_api_key",
      cookie: session.cookie,
    });
    expect(apiKeyResponse.status).toBe(400);
    await expect(apiKeyResponse.json()).resolves.toEqual({
      code: "INVALID_PROVIDER_CONFIG_INPUT",
      message:
        "Integration connection 'icn_integration_new_identity_link_api_key' uses connection method 'api-key', which is not eligible for identity linking provider 'github'.",
    });

    const missingAuthResponse = await putProviderConnection(env, {
      connectionId: "icn_integration_new_identity_link_missing_auth",
      cookie: session.cookie,
    });
    expect(missingAuthResponse.status).toBe(400);
    await expect(missingAuthResponse.json()).resolves.toMatchObject({
      code: "INVALID_PROVIDER_CONFIG_INPUT",
    });
  });

  it("rejects enabling a saved provider when its connection is no longer valid", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-identity-link-providers-enable-invalid@example.com",
    });
    await upsertGitHubTarget(env, "github-cloud");
    await seedConnection(env, {
      config: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      },
      connectionId: "icn_integration_new_identity_link_revoked",
      displayName: "GitHub Identity Revoked",
      organizationId: session.organizationId,
      status: IntegrationConnectionStatuses.REVOKED,
      targetKey: "github-cloud",
    });
    await seedIdentityLinkProviderConfig(env, {
      connectionId: "icn_integration_new_identity_link_revoked",
      organizationId: session.organizationId,
      status: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
      userId: session.userId,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/organization/identity-linking/providers/github/status",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        }),
      },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_PROVIDER_CONFIG_INPUT",
    });

    const persistedConfig =
      await env.controlPlaneDb.query.organizationIdentityLinkProviderConfigs.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.organizationId, session.organizationId), eq(table.providerFamily, "github")),
      });
    expect(persistedConfig?.status).toBe(OrganizationIdentityLinkProviderConfigStatus.DISABLED);
  });

  it("returns forbidden when a member manages identity-linking provider settings", async ({
    env,
  }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-new-identity-link-providers-member-owner@example.com",
    });
    const memberSession = await env.auth.createSession({
      email: "integration-new-identity-link-providers-member-member@example.com",
    });
    await addMemberToOrganization(env, {
      organizationId: ownerSession.organizationId,
      role: MemberRoles.MEMBER,
      userId: memberSession.userId,
    });
    await upsertGitHubTarget(env, "github-cloud");

    const listResponse = await env.controlPlaneApi.http.fetch(
      "/v1/organization/identity-linking/providers",
      {
        headers: {
          cookie: memberSession.cookie,
        },
      },
    );
    expect(listResponse.status).toBe(403);
    await expect(listResponse.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });

    const linksResponse = await env.controlPlaneApi.http.fetch(
      "/v1/organization/identity-linking/providers/github/links",
      {
        headers: {
          cookie: memberSession.cookie,
        },
      },
    );
    expect(linksResponse.status).toBe(403);
    await expect(linksResponse.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });

  it("lists only GitHub connections that are ready for linked-account authorization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-identity-link-providers-ready@example.com",
    });
    await upsertGitHubTarget(env, "github-cloud");
    await seedConnection(env, {
      config: {
        app_id: "12345",
        app_slug: "mistle-github-app",
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      },
      connectionId: "icn_integration_new_identity_link_missing_client_id",
      displayName: "GitHub Missing Client ID",
      organizationId: session.organizationId,
      status: IntegrationConnectionStatuses.ACTIVE,
      targetKey: "github-cloud",
    });
    const readyConnectionId = await createGitHubIdentityLinkReadyConnection(env, {
      displayName: "GitHub Ready",
      session,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/organization/identity-linking/providers",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(response.status).toBe(200);

    const payload = OrganizationIdentityLinkProvidersResponseSchema.parse(await response.json());
    const githubProvider = payload.providers.find(
      (provider) => provider.providerFamily === "github",
    );
    expect(githubProvider?.eligibleConnections.map((connection) => connection.id)).toEqual([
      readyConnectionId,
    ]);
  });

  it("lists member link visibility for owners and admins", async ({ env }) => {
    const ownerEmail = "integration-new-identity-link-provider-links-owner@example.com";
    const adminEmail = "integration-new-identity-link-provider-links-admin@example.com";
    const memberEmail = "integration-new-identity-link-provider-links-member@example.com";
    const ownerSession = await env.auth.createSession({ email: ownerEmail });
    const adminSession = await env.auth.createSession({ email: adminEmail });
    const memberSession = await env.auth.createSession({ email: memberEmail });

    await addMemberToOrganization(env, {
      organizationId: ownerSession.organizationId,
      role: MemberRoles.ADMIN,
      userId: adminSession.userId,
    });
    await addMemberToOrganization(env, {
      organizationId: ownerSession.organizationId,
      role: MemberRoles.MEMBER,
      userId: memberSession.userId,
    });
    await upsertGitHubTarget(env, "github-cloud");
    const connectionId = await createGitHubIdentityLinkReadyConnection(env, {
      displayName: "GitHub Identity Visibility",
      session: ownerSession,
    });
    await seedIdentityLinkProviderConfig(env, {
      configId: "ilp_integration_new_identity_link_links_visibility",
      connectionId,
      organizationId: ownerSession.organizationId,
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      userId: ownerSession.userId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.userExternalPrincipals).values([
      {
        id: "uep_integration_new_identity_link_links_owner",
        organizationId: ownerSession.organizationId,
        userId: ownerSession.userId,
        providerFamily: "github",
        providerSubjectId: "github-owner-123",
        organizationProviderConfigId: "ilp_integration_new_identity_link_links_visibility",
        integrationConnectionId: connectionId,
        status: UserExternalPrincipalStatuses.ACTIVE,
        profile: {
          login: "owner-github",
          displayName: "Owner GitHub",
          email: ownerEmail,
        },
      },
      {
        id: "uep_integration_new_identity_link_links_admin",
        organizationId: ownerSession.organizationId,
        userId: adminSession.userId,
        providerFamily: "github",
        providerSubjectId: "github-admin-456",
        organizationProviderConfigId: "ilp_integration_new_identity_link_links_visibility",
        integrationConnectionId: connectionId,
        status: UserExternalPrincipalStatuses.ACTIVE,
        profile: {
          login: "admin-github",
          displayName: "Admin GitHub",
          email: adminEmail,
        },
      },
    ]);

    for (const session of [ownerSession, adminSession]) {
      const response = await env.controlPlaneApi.http.fetch(
        "/v1/organization/identity-linking/providers/github/links",
        {
          headers: {
            cookie: session.cookie,
          },
        },
      );
      expect(response.status).toBe(200);

      const payload = OrganizationIdentityLinkProviderLinksResponseSchema.parse(
        await response.json(),
      );
      expect(payload.links).toHaveLength(3);
      expect(payload.links).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: ownerSession.userId,
            email: ownerEmail,
            linked: true,
            principalSummary: {
              providerSubjectId: "github-owner-123",
              login: "owner-github",
              displayName: "Owner GitHub",
              email: ownerEmail,
            },
          }),
          expect.objectContaining({
            userId: adminSession.userId,
            email: adminEmail,
            linked: true,
            principalSummary: {
              providerSubjectId: "github-admin-456",
              login: "admin-github",
              displayName: "Admin GitHub",
              email: adminEmail,
            },
          }),
          expect.objectContaining({
            userId: memberSession.userId,
            email: memberEmail,
            linked: false,
            principalSummary: null,
            updatedAt: null,
          }),
        ]),
      );
    }
  });
});

async function putProviderConnection(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    cookie: string;
  },
) {
  return await env.controlPlaneApi.http.fetch(
    "/v1/organization/identity-linking/providers/github",
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: input.cookie,
      },
      body: JSON.stringify({
        integrationConnectionId: input.connectionId,
      }),
    },
  );
}

async function addMemberToOrganization(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    userId: string;
    role: (typeof MemberRoles)[keyof typeof MemberRoles];
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.members).values({
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role,
  });

  await env.controlPlaneDb
    .update(env.controlPlaneTables.sessions)
    .set({
      activeOrganizationId: input.organizationId,
    })
    .where(eq(env.controlPlaneTables.sessions.userId, input.userId));
}

async function upsertGitHubTarget(
  env: IntegrationTestEnvironment,
  targetKey: string,
): Promise<void> {
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.integrationTargets)
    .values({
      targetKey,
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    })
    .onConflictDoUpdate({
      target: env.controlPlaneTables.integrationTargets.targetKey,
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

async function upsertSlackTarget(
  env: IntegrationTestEnvironment,
  targetKey: string,
): Promise<void> {
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.integrationTargets)
    .values({
      targetKey,
      familyId: "slack",
      variantId: "slack-default",
      enabled: true,
      config: {
        api_base_url: "https://slack.com/api",
      },
    })
    .onConflictDoUpdate({
      target: env.controlPlaneTables.integrationTargets.targetKey,
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

async function createGitHubIdentityLinkReadyConnection(
  env: IntegrationTestEnvironment,
  input: {
    displayName: string;
    session: IntegrationAuthenticatedSession;
  },
): Promise<string> {
  const response = await env.controlPlaneApi.http.fetch(
    "/v1/integration/connections/github-cloud/form",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.session.cookie,
      },
      body: JSON.stringify({
        displayName: input.displayName,
        methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        config: {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          app_id: "12345",
          app_slug: "mistle-github-app",
          client_id: "Iv1.client123",
        },
        secrets: {
          appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
          clientSecret: "github-client-secret",
          webhookSecret: "github-webhook-secret",
        },
      }),
    },
  );
  expect(response.status).toBe(201);

  const payload: unknown = await response.json().catch(() => null);
  const connectionId = readStringField(payload, "id");
  if (connectionId === null) {
    throw new Error("Expected GitHub App connection create response to include id.");
  }

  return connectionId;
}

async function seedConnection(
  env: IntegrationTestEnvironment,
  input: {
    config: Record<string, unknown>;
    connectionId: string;
    displayName: string;
    organizationId: string;
    status: IntegrationConnectionStatus;
    targetKey: string;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
    id: input.connectionId,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    displayName: input.displayName,
    status: input.status,
    config: input.config,
  });
}

async function seedSlackIdentityLinkReadyConnection(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    displayName: string;
    organizationId: string;
    teamId: string;
  },
): Promise<void> {
  await seedConnection(env, {
    config: {
      connection_method: SlackConnectionMethodIds.SLACK_APP,
      client_id: `client-${input.teamId}`,
    },
    connectionId: input.connectionId,
    displayName: input.displayName,
    organizationId: input.organizationId,
    status: IntegrationConnectionStatuses.ACTIVE,
    targetKey: "slack-default",
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationCredentials).values({
    id: `icr_${input.connectionId}`,
    organizationId: input.organizationId,
    secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
    ciphertext: `ciphertext-${input.connectionId}`,
    nonce: `nonce-${input.connectionId}`,
    organizationCredentialKeyVersion: 1,
    intendedFamilyId: "slack",
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnectionCredentials).values({
    connectionId: input.connectionId,
    credentialId: `icr_${input.connectionId}`,
    slotKey: SlackCredentialSlotKeys.CLIENT_SECRET,
  });
}

async function seedIdentityLinkProviderConfig(
  env: IntegrationTestEnvironment,
  input: {
    configId?: string;
    connectionId: string;
    organizationId: string;
    status: OrganizationIdentityLinkProviderConfigStatus;
    userId: string;
  },
): Promise<void> {
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.organizationIdentityLinkProviderConfigs)
    .values({
      ...(input.configId === undefined ? {} : { id: input.configId }),
      organizationId: input.organizationId,
      providerFamily: "github",
      status: input.status,
      integrationTargetKey: "github-cloud",
      integrationConnectionId: input.connectionId,
      createdByUserId: input.userId,
      updatedByUserId: input.userId,
    });
}

function readStringField(payload: unknown, field: string): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const value = Reflect.get(payload, field);
  return typeof value === "string" && value.length > 0 ? value : null;
}
