import {
  integrationConnections,
  integrationTargets,
  MemberRoles,
  members,
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
  IntegrationConnectionStatuses,
  sessions,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { SlackConnectionMethodIds } from "@mistle/integrations-definitions";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import {
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
          eligibleConnectionMethodIds: [SlackConnectionMethodIds.SLACK_BOT_TOKEN],
          configurationStatus: "unconfigured",
          selectedConnection: null,
          configuredAt: null,
          updatedAt: null,
        },
      ],
    });
  });

  it("configures a GitHub identity-linking provider from an eligible connection", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "organization-identity-link-providers-configure@example.com",
    });

    await upsertGitHubTarget({
      fixture,
      targetKey: "github-cloud",
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_identity_github_app",
      organizationId: session.organizationId,
      targetKey: "github-cloud",
      displayName: "GitHub Identity App",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: "12345",
      },
    });

    const response = await fixture.request("/v1/organization/identity-linking/providers/github", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        integrationConnectionId: "icn_identity_github_app",
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
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      selectedConnection: {
        id: "icn_identity_github_app",
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
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      integrationTargetKey: "github-cloud",
      integrationConnectionId: "icn_identity_github_app",
      createdByUserId: session.userId,
      updatedByUserId: session.userId,
    });
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
    await fixture.db.insert(integrationConnections).values({
      id: "icn_identity_disable",
      organizationId: session.organizationId,
      targetKey: "github-cloud",
      displayName: "GitHub Identity Disable",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      },
    });
    await fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      integrationTargetKey: "github-cloud",
      integrationConnectionId: "icn_identity_disable",
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
      configurationStatus: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
      selectedConnection: {
        id: "icn_identity_disable",
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
    expect(persistedConfig?.integrationConnectionId).toBe("icn_identity_disable");
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
    await fixture.db.insert(integrationConnections).values({
      id: "icn_identity_delete_guard",
      organizationId: session.organizationId,
      targetKey: "github-cloud",
      displayName: "GitHub Identity Guard",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      },
    });
    await fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      integrationTargetKey: "github-cloud",
      integrationConnectionId: "icn_identity_delete_guard",
      createdByUserId: session.userId,
      updatedByUserId: session.userId,
    });

    const response = await fixture.request(
      "/v1/integration/connections/icn_identity_delete_guard",
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "CONNECTION_USED_BY_IDENTITY_LINKING",
      message:
        "This integration connection cannot be deleted while it is configured for Identity Linking.",
    });

    const persistedConnection = await fixture.db.query.integrationConnections.findFirst({
      where: (table, { eq }) => eq(table.id, "icn_identity_delete_guard"),
    });
    expect(persistedConnection).toBeDefined();
  });
});

async function addMemberToActiveOrganization(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await input.fixture.db.insert(members).values({
    organizationId: input.organizationId,
    userId: input.userId,
    role: MemberRoles.MEMBER,
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
