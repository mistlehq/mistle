import {
  integrationConnections,
  integrationTargets,
  MemberRoles,
  members,
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
  IntegrationConnectionStatuses,
  sessions,
  userExternalPrincipals,
  UserExternalPrincipalStatuses,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { SlackConnectionMethodIds } from "@mistle/integrations-definitions";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import {
  OrganizationIdentityLinkProviderLinksResponseSchema,
  OrganizationIdentityLinkProviderSchema,
  OrganizationIdentityLinkProvidersResponseSchema,
} from "../src/organizations/schemas.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";
import { it } from "./test-context.js";

describe("organization identity-linking providers integration", () => {
  it("lists supported providers for the active organization with unconfigured status by default", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "organization-identity-link-providers-list@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    await upsertSlackTarget({
      fixture,
      targetKey: "slack-default",
    });

    const response = await fixture.request("/v1/organization/identity-linking/providers", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const payload = OrganizationIdentityLinkProvidersResponseSchema.parse(await response.json());

    expect(payload).toEqual({
      providers: [
        {
          providerFamily: "github",
          displayName: "GitHub",
          logoKey: "github",
          eligibleTargetKeys: ["github-cloud"],
          eligibleConnectionMethodIds: [IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION],
          eligibleConnections: [],
          configurationStatus: "unconfigured",
          selectedConnection: null,
          configuredAt: null,
          updatedAt: null,
        },
        {
          providerFamily: "slack",
          displayName: "Slack",
          logoKey: "slack",
          eligibleTargetKeys: ["slack-default"],
          eligibleConnectionMethodIds: [SlackConnectionMethodIds.SLACK_APP],
          eligibleConnections: [],
          configurationStatus: "unconfigured",
          selectedConnection: null,
          configuredAt: null,
          updatedAt: null,
        },
      ],
    });
  });

  it("saves a GitHub identity-linking provider connection without auto-enabling it", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "organization-identity-link-providers-configure@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    const connectionId = await createGitHubIdentityLinkReadyConnection({
      fixture,
      authenticatedSession: session,
      displayName: "GitHub Identity App",
    });

    const response = await fixture.request("/v1/organization/identity-linking/providers/github", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        integrationConnectionId: connectionId,
      }),
    });

    expect(response.status).toBe(200);
    const payload = OrganizationIdentityLinkProviderSchema.parse(await response.json());

    expect(payload).toEqual({
      providerFamily: "github",
      displayName: "GitHub",
      logoKey: "github",
      eligibleTargetKeys: ["github-cloud"],
      eligibleConnectionMethodIds: [IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION],
      eligibleConnections: [
        {
          id: connectionId,
          targetKey: "github-cloud",
          displayName: "GitHub Identity App",
          status: IntegrationConnectionStatuses.ACTIVE,
          connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          connectionMethodLabel: "GitHub App installation",
          createdAt: payload.eligibleConnections[0]?.createdAt ?? "",
          updatedAt: payload.eligibleConnections[0]?.updatedAt ?? "",
        },
      ],
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
      selectedConnection: {
        id: connectionId,
        targetKey: "github-cloud",
        displayName: "GitHub Identity App",
        status: IntegrationConnectionStatuses.ACTIVE,
        connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        connectionMethodLabel: "GitHub App installation",
        createdAt: payload.selectedConnection?.createdAt ?? "",
        updatedAt: payload.selectedConnection?.updatedAt ?? "",
      },
      configuredAt: payload.configuredAt,
      updatedAt: payload.updatedAt,
    });

    const persistedConfig =
      await fixture.db.query.organizationIdentityLinkProviderConfigs.findFirst({
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
  });

  it("enables a saved identity-linking provider through the status endpoint", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "organization-identity-link-providers-enable@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    const connectionId = await createGitHubIdentityLinkReadyConnection({
      fixture,
      authenticatedSession: session,
      displayName: "GitHub Identity Enable",
    });
    await fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
      integrationTargetKey: "github-cloud",
      integrationConnectionId: connectionId,
      createdByUserId: session.userId,
      updatedByUserId: session.userId,
    });

    const response = await fixture.request(
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

    expect(response.status).toBe(200);
    const payload = OrganizationIdentityLinkProviderSchema.parse(await response.json());

    expect(payload.configurationStatus).toBe(OrganizationIdentityLinkProviderConfigStatus.ACTIVE);
    expect(payload.selectedConnection?.id).toBe(connectionId);

    const persistedConfig =
      await fixture.db.query.organizationIdentityLinkProviderConfigs.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.organizationId, session.organizationId), eq(table.providerFamily, "github")),
      });

    expect(persistedConfig?.status).toBe(OrganizationIdentityLinkProviderConfigStatus.ACTIVE);
  });

  it("rejects enabling a saved provider when its connection is no longer valid", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "organization-identity-link-providers-enable-invalid@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_identity_revoked",
      organizationId: session.organizationId,
      targetKey: "github-cloud",
      displayName: "GitHub Identity Revoked",
      status: IntegrationConnectionStatuses.REVOKED,
      config: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      },
    });
    await fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
      integrationTargetKey: "github-cloud",
      integrationConnectionId: "icn_identity_revoked",
      createdByUserId: session.userId,
      updatedByUserId: session.userId,
    });

    const response = await fixture.request(
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
    expect(await response.json()).toMatchObject({
      code: "INVALID_PROVIDER_CONFIG_INPUT",
    });

    const persistedConfig =
      await fixture.db.query.organizationIdentityLinkProviderConfigs.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.organizationId, session.organizationId), eq(table.providerFamily, "github")),
      });

    expect(persistedConfig?.status).toBe(OrganizationIdentityLinkProviderConfigStatus.DISABLED);
  });

  it("rejects connections that use an ineligible connection method", async ({ fixture }) => {
    const session = await fixture.authSession({
      email: "organization-identity-link-providers-ineligible-method@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_identity_github_api_key",
      organizationId: session.organizationId,
      targetKey: "github-cloud",
      displayName: "GitHub API key",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
    });

    const response = await fixture.request("/v1/organization/identity-linking/providers/github", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        integrationConnectionId: "icn_identity_github_api_key",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_PROVIDER_CONFIG_INPUT",
      message:
        "Integration connection 'icn_identity_github_api_key' uses connection method 'api-key', which is not eligible for identity linking provider 'github'.",
    });
  });

  it("rejects GitHub App connections that are missing linked-account auth config", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "organization-identity-link-providers-missing-client-credentials@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_identity_github_missing_client_credentials",
      organizationId: session.organizationId,
      targetKey: "github-cloud",
      displayName: "GitHub Missing Client Credentials",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: "12345",
        app_slug: "mistle-github-app",
      },
    });

    const response = await fixture.request("/v1/organization/identity-linking/providers/github", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        integrationConnectionId: "icn_identity_github_missing_client_credentials",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_PROVIDER_CONFIG_INPUT",
      message:
        "Integration connection 'icn_identity_github_missing_client_credentials' is missing required linked-user authorization configuration for identity linking.",
    });
  });

  it("disables a configured identity-linking provider without deleting the row", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "organization-identity-link-providers-disable@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    const connectionId = await createGitHubIdentityLinkReadyConnection({
      fixture,
      authenticatedSession: session,
      displayName: "GitHub Identity Disable",
    });
    await fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      integrationTargetKey: "github-cloud",
      integrationConnectionId: connectionId,
      createdByUserId: session.userId,
      updatedByUserId: session.userId,
    });

    const response = await fixture.request("/v1/organization/identity-linking/providers/github", {
      method: "DELETE",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const payload = OrganizationIdentityLinkProviderSchema.parse(await response.json());

    expect(payload).toEqual({
      providerFamily: "github",
      displayName: "GitHub",
      logoKey: "github",
      eligibleTargetKeys: ["github-cloud"],
      eligibleConnectionMethodIds: [IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION],
      eligibleConnections: [
        {
          id: connectionId,
          targetKey: "github-cloud",
          displayName: "GitHub Identity Disable",
          status: IntegrationConnectionStatuses.ACTIVE,
          connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          connectionMethodLabel: "GitHub App installation",
          createdAt: payload.eligibleConnections[0]?.createdAt ?? "",
          updatedAt: payload.eligibleConnections[0]?.updatedAt ?? "",
        },
      ],
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
      selectedConnection: {
        id: connectionId,
        targetKey: "github-cloud",
        displayName: "GitHub Identity Disable",
        status: IntegrationConnectionStatuses.ACTIVE,
        connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        connectionMethodLabel: "GitHub App installation",
        createdAt: payload.selectedConnection?.createdAt ?? "",
        updatedAt: payload.selectedConnection?.updatedAt ?? "",
      },
      configuredAt: payload.configuredAt,
      updatedAt: payload.updatedAt,
    });

    const persistedConfig =
      await fixture.db.query.organizationIdentityLinkProviderConfigs.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.organizationId, session.organizationId), eq(table.providerFamily, "github")),
      });

    expect(persistedConfig?.status).toBe(OrganizationIdentityLinkProviderConfigStatus.DISABLED);
    expect(persistedConfig?.integrationConnectionId).toBe(connectionId);
  });

  it("returns forbidden when a member tries to list identity-linking providers", async ({
    fixture,
  }) => {
    const ownerSession = await fixture.authSession({
      email: "organization-identity-link-providers-member-owner@example.com",
    });
    const memberSession = await fixture.authSession({
      email: "organization-identity-link-providers-member-member@example.com",
    });

    await addMemberToActiveOrganization({
      fixture,
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
    });
    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });

    const response = await fixture.request("/v1/organization/identity-linking/providers", {
      headers: {
        cookie: memberSession.cookie,
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });

  it("blocks deletion of connections that are actively used by identity linking", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "organization-identity-link-providers-delete-guard@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    const connectionId = await createGitHubIdentityLinkReadyConnection({
      fixture,
      authenticatedSession: session,
      displayName: "GitHub Identity Guard",
    });
    await fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      integrationTargetKey: "github-cloud",
      integrationConnectionId: connectionId,
      createdByUserId: session.userId,
      updatedByUserId: session.userId,
    });

    const response = await fixture.request(`/v1/integration/connections/${connectionId}`, {
      method: "DELETE",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "CONNECTION_USED_BY_IDENTITY_LINKING",
      message:
        "This integration connection cannot be deleted while it is configured for Identity Linking.",
    });

    const persistedConnection = await fixture.db.query.integrationConnections.findFirst({
      where: (table, { eq }) => eq(table.id, connectionId),
    });
    expect(persistedConnection).toBeDefined();
  });

  it("lists only GitHub connections that are actually ready for linked-account authorization", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "organization-identity-link-providers-ready-connections@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_github_missing_client_id",
      organizationId: session.organizationId,
      targetKey: "github-cloud",
      displayName: "GitHub Missing Client ID",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: "12345",
        app_slug: "mistle-github-app",
      },
    });
    const readyConnectionId = await createGitHubIdentityLinkReadyConnection({
      fixture,
      authenticatedSession: session,
      displayName: "GitHub Ready",
    });

    const response = await fixture.request("/v1/organization/identity-linking/providers", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const payload = OrganizationIdentityLinkProvidersResponseSchema.parse(await response.json());
    expect(payload.providers[0]).toMatchObject({
      providerFamily: "github",
      eligibleConnections: [
        {
          id: readyConnectionId,
          displayName: "GitHub Ready",
        },
      ],
    });
  });

  it("lists member link visibility for an identity-linking provider to owners and admins", async ({
    fixture,
  }) => {
    const ownerSession = await fixture.authSession({
      email: "organization-identity-link-provider-links-owner@example.com",
    });
    const ownerEmail = "organization-identity-link-provider-links-owner@example.com";
    const adminSession = await fixture.authSession({
      email: "organization-identity-link-provider-links-admin@example.com",
    });
    const adminEmail = "organization-identity-link-provider-links-admin@example.com";
    const memberSession = await fixture.authSession({
      email: "organization-identity-link-provider-links-member@example.com",
    });
    const memberEmail = "organization-identity-link-provider-links-member@example.com";

    await addMemberToOrganization({
      fixture,
      organizationId: ownerSession.organizationId,
      userId: adminSession.userId,
      role: MemberRoles.ADMIN,
    });
    await addMemberToOrganization({
      fixture,
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
      role: MemberRoles.MEMBER,
    });
    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    const connectionId = await createGitHubIdentityLinkReadyConnection({
      fixture,
      authenticatedSession: ownerSession,
      displayName: "GitHub Identity Visibility",
    });
    await fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
      id: "ilp_github_links_visibility",
      organizationId: ownerSession.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      integrationTargetKey: "github-cloud",
      integrationConnectionId: connectionId,
      createdByUserId: ownerSession.userId,
      updatedByUserId: ownerSession.userId,
    });
    await fixture.db.insert(userExternalPrincipals).values([
      {
        id: "uep_github_links_visibility_owner",
        organizationId: ownerSession.organizationId,
        userId: ownerSession.userId,
        providerFamily: "github",
        providerSubjectId: "github-owner-123",
        organizationProviderConfigId: "ilp_github_links_visibility",
        integrationConnectionId: connectionId,
        status: UserExternalPrincipalStatuses.ACTIVE,
        profile: {
          login: "owner-github",
          displayName: "Owner GitHub",
          email: ownerEmail,
        },
      },
      {
        id: "uep_github_links_visibility_admin",
        organizationId: ownerSession.organizationId,
        userId: adminSession.userId,
        providerFamily: "github",
        providerSubjectId: "github-admin-456",
        organizationProviderConfigId: "ilp_github_links_visibility",
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
      const response = await fixture.request(
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

  it("returns forbidden when a member tries to list provider link visibility", async ({
    fixture,
  }) => {
    const ownerSession = await fixture.authSession({
      email: "organization-identity-link-provider-links-forbidden-owner@example.com",
    });
    const memberSession = await fixture.authSession({
      email: "organization-identity-link-provider-links-forbidden-member@example.com",
    });

    await addMemberToOrganization({
      fixture,
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
      role: MemberRoles.MEMBER,
    });

    const response = await fixture.request(
      "/v1/organization/identity-linking/providers/github/links",
      {
        headers: {
          cookie: memberSession.cookie,
        },
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });
});

async function addMemberToActiveOrganization(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await addMemberToOrganization({
    ...input,
    role: MemberRoles.MEMBER,
  });
}

async function addMemberToOrganization(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  userId: string;
  role: (typeof MemberRoles)[keyof typeof MemberRoles];
}): Promise<void> {
  await input.fixture.db.insert(members).values({
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role,
  });

  await input.fixture.db
    .update(sessions)
    .set({
      activeOrganizationId: input.organizationId,
    })
    .where(eq(sessions.userId, input.userId));
}

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

async function createGitHubIdentityLinkReadyConnection(input: {
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
