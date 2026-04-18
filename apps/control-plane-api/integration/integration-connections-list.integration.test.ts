import {
  automations,
  AutomationKinds,
  integrationConnectionCredentials,
  integrationConnectionResourceStates,
  integrationConnections,
  IntegrationConnectionStatuses,
  IntegrationConnectionResourceSyncStates,
  integrationCredentials,
  IntegrationCredentialSecretKinds,
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
  integrationTargets,
  integrationWebhookSources,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  webhookAutomations,
} from "@mistle/db/control-plane";
import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { describe, expect } from "vitest";

import { ListIntegrationConnectionsResponseSchema } from "../src/integration-connections/list-integration-connections/schema.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";
import { it } from "./test-context.js";

describe("integration connections list integration", () => {
  it("returns keyset paginated integration connections scoped to active organization", async ({
    fixture,
  }) => {
    const firstOrgSession = await fixture.authSession({
      email: "integration-connections-list-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "integration-connections-list-org-b@example.com",
    });

    await ensureListTargets(fixture);

    const firstConnectionCreatedAt = new Date("2026-01-01T00:00:00.000Z");
    const secondConnectionCreatedAt = new Date("2026-01-02T00:00:00.000Z");
    const thirdConnectionCreatedAt = new Date("2026-01-03T00:00:00.000Z");

    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_001",
        organizationId: firstOrgSession.organizationId,
        targetKey: "github_cloud",
        displayName: "GitHub Main",
        status: IntegrationConnectionStatuses.ACTIVE,
        externalSubjectId: "github-user-1",
        config: {
          installation_id: "12345",
        },
        targetSnapshotConfig: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
        createdAt: firstConnectionCreatedAt.toISOString(),
        updatedAt: firstConnectionCreatedAt.toISOString(),
      },
      {
        id: "icn_002",
        organizationId: firstOrgSession.organizationId,
        targetKey: "openai-default",
        displayName: "OpenAI Backup",
        status: IntegrationConnectionStatuses.ERROR,
        createdAt: secondConnectionCreatedAt.toISOString(),
        updatedAt: secondConnectionCreatedAt.toISOString(),
      },
      {
        id: "icn_003",
        organizationId: firstOrgSession.organizationId,
        targetKey: "github_cloud",
        displayName: "GitHub Revoked",
        status: IntegrationConnectionStatuses.REVOKED,
        createdAt: thirdConnectionCreatedAt.toISOString(),
        updatedAt: thirdConnectionCreatedAt.toISOString(),
      },
      {
        id: "icn_004",
        organizationId: secondOrgSession.organizationId,
        targetKey: "github_cloud",
        displayName: "Other Org",
        status: IntegrationConnectionStatuses.ACTIVE,
        createdAt: thirdConnectionCreatedAt.toISOString(),
        updatedAt: thirdConnectionCreatedAt.toISOString(),
      },
    ]);

    await fixture.db.insert(integrationConnectionResourceStates).values({
      connectionId: "icn_001",
      familyId: "github",
      kind: "repository",
      syncState: IntegrationConnectionResourceSyncStates.READY,
      totalCount: 7,
      lastSyncedAt: "2026-01-04T00:00:00.000Z",
      lastSyncStartedAt: "2026-01-04T00:00:00.000Z",
      lastSyncFinishedAt: "2026-01-04T00:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
    });

    await fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
      id: "ilp_001",
      organizationId: firstOrgSession.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      integrationTargetKey: "github_cloud",
      integrationConnectionId: "icn_001",
      createdByUserId: firstOrgSession.userId,
      updatedByUserId: firstOrgSession.userId,
    });

    await insertBindingUsage(fixture, {
      organizationId: firstOrgSession.organizationId,
      profileId: "spf_001",
      profileDisplayName: "Profile 1",
      bindingId: "ibd_001",
      connectionId: "icn_001",
    });
    await insertWebhookAutomationUsage(fixture, {
      organizationId: firstOrgSession.organizationId,
      automationId: "atm_001",
      automationName: "GitHub webhook automation",
      connectionId: "icn_002",
      targetKey: "openai-default",
      eventTypes: ["response.created"],
      payloadFilter: {
        "response.created": {
          op: "eq",
          path: ["type"],
          value: "response.created",
        },
      },
    });

    const firstPageResponse = await fixture.request("/v1/integration/connections?limit=2", {
      headers: {
        cookie: firstOrgSession.cookie,
      },
    });
    expect(firstPageResponse.status).toBe(200);
    const firstPage = ListIntegrationConnectionsResponseSchema.parse(
      await firstPageResponse.json(),
    );
    const normalizedFirstPageItems = firstPage.items.map((item) => ({
      ...item,
      createdAt: new Date(item.createdAt).toISOString(),
      updatedAt: new Date(item.updatedAt).toISOString(),
    }));

    expect(firstPage.totalResults).toBe(3);
    expect(normalizedFirstPageItems).toEqual([
      {
        id: "icn_001",
        targetKey: "github_cloud",
        displayName: "GitHub Main",
        status: IntegrationConnectionStatuses.ACTIVE,
        bindingCount: 1,
        automationCount: 0,
        isIdentityLinked: true,
        externalSubjectId: "github-user-1",
        config: {
          installation_id: "12345",
        },
        targetSnapshotConfig: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
        resources: [
          {
            kind: "repository",
            selectionMode: "multi",
            count: 7,
            syncState: IntegrationConnectionResourceSyncStates.READY,
            lastSyncedAt: "2026-01-04T00:00:00.000Z",
          },
          {
            kind: "branch",
            selectionMode: "multi",
            count: 0,
            syncState: IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
          },
          {
            kind: "user",
            selectionMode: "multi",
            count: 0,
            syncState: IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
          },
        ],
        supportsWebhookSources: false,
        createdAt: firstConnectionCreatedAt.toISOString(),
        updatedAt: firstConnectionCreatedAt.toISOString(),
      },
      {
        id: "icn_002",
        targetKey: "openai-default",
        displayName: "OpenAI Backup",
        status: IntegrationConnectionStatuses.ERROR,
        bindingCount: 0,
        automationCount: 1,
        createdAt: secondConnectionCreatedAt.toISOString(),
        updatedAt: secondConnectionCreatedAt.toISOString(),
      },
    ]);
    expect(firstPage.previousPage).toBeNull();
    expect(firstPage.nextPage).not.toBeNull();

    if (firstPage.nextPage === null) {
      throw new Error("Expected next page cursor.");
    }

    const secondPageResponse = await fixture.request(
      `/v1/integration/connections?limit=2&after=${encodeURIComponent(firstPage.nextPage.after)}`,
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );
    expect(secondPageResponse.status).toBe(200);
    const secondPage = ListIntegrationConnectionsResponseSchema.parse(
      await secondPageResponse.json(),
    );
    const normalizedSecondPageItems = secondPage.items.map((item) => ({
      ...item,
      createdAt: new Date(item.createdAt).toISOString(),
      updatedAt: new Date(item.updatedAt).toISOString(),
    }));

    expect(secondPage.totalResults).toBe(3);
    expect(normalizedSecondPageItems).toEqual([
      {
        id: "icn_003",
        targetKey: "github_cloud",
        displayName: "GitHub Revoked",
        status: IntegrationConnectionStatuses.REVOKED,
        bindingCount: 0,
        automationCount: 0,
        resources: [
          {
            kind: "repository",
            selectionMode: "multi",
            count: 0,
            syncState: IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
          },
          {
            kind: "branch",
            selectionMode: "multi",
            count: 0,
            syncState: IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
          },
          {
            kind: "user",
            selectionMode: "multi",
            count: 0,
            syncState: IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
          },
        ],
        createdAt: thirdConnectionCreatedAt.toISOString(),
        updatedAt: thirdConnectionCreatedAt.toISOString(),
      },
    ]);
    expect(secondPage.nextPage).toBeNull();
    expect(secondPage.previousPage).not.toBeNull();

    if (secondPage.previousPage === null) {
      throw new Error("Expected previous page cursor.");
    }

    const previousPageResponse = await fixture.request(
      `/v1/integration/connections?limit=2&before=${encodeURIComponent(secondPage.previousPage.before)}`,
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );
    expect(previousPageResponse.status).toBe(200);
    const previousPage = ListIntegrationConnectionsResponseSchema.parse(
      await previousPageResponse.json(),
    );

    expect(previousPage.totalResults).toBe(3);
    expect(previousPage.items.map((connection) => connection.id)).toEqual(["icn_001", "icn_002"]);
  });

  it("returns 400 for invalid pagination cursor", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-list-invalid-cursor@example.com",
    });

    const response = await fixture.request("/v1/integration/connections?after=invalid-cursor", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(400);

    const bodyText = await response.text();
    expect(bodyText).toContain('"code":"INVALID_PAGINATION_CURSOR"');
  });

  it("reports webhook-source support per connection for mixed GitHub auth methods", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-list-github-webhook-support@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "github-cloud-webhook-support",
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    });

    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_github_app_support",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-cloud-webhook-support",
        displayName: "GitHub App",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          app_id: "123",
          app_slug: "mistle-github-app",
        },
      },
      {
        id: "icn_github_api_key_no_support",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-cloud-webhook-support",
        displayName: "GitHub API key",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
    ]);

    const response = await fixture.request("/v1/integration/connections", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(200);
    const body = ListIntegrationConnectionsResponseSchema.parse(await response.json());

    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "icn_github_app_support",
          connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          connectionMethodLabel: "GitHub App installation",
          supportsWebhookSources: true,
        }),
        expect.objectContaining({
          id: "icn_github_api_key_no_support",
          connectionMethodId: IntegrationConnectionMethodIds.API_KEY,
          connectionMethodLabel: "API key",
          supportsWebhookSources: false,
        }),
      ]),
    );
  });

  it("returns auth method metadata resolved from the integration definition", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-list-jira-auth-method@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "jira-default-auth-method",
      familyId: "jira",
      variantId: "jira-default",
      enabled: true,
      config: {
        site_url: "https://mistle.atlassian.net",
        cloud_id: "cloud_123",
      },
    });

    await fixture.db.insert(integrationConnections).values({
      id: "icn_jira_service_account",
      organizationId: authenticatedSession.organizationId,
      targetKey: "jira-default-auth-method",
      displayName: "Jira service account",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "jira-service-account-api-token",
      },
    });

    const response = await fixture.request("/v1/integration/connections", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(200);
    const body = ListIntegrationConnectionsResponseSchema.parse(await response.json());

    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "icn_jira_service_account",
          connectionMethodId: "jira-service-account-api-token",
          connectionMethodLabel: "Service account API token",
        }),
      ]),
    );
  });

  it("reports webhook-source support for Slack implicit webhook connections", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-list-slack-webhook-support@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "slack-default",
      familyId: "slack",
      variantId: "slack-default",
      enabled: true,
      config: {
        api_base_url: "https://slack.com/api",
      },
    });

    await fixture.db.insert(integrationConnections).values({
      id: "icn_slack_support",
      organizationId: authenticatedSession.organizationId,
      targetKey: "slack-default",
      displayName: "Slack webhook connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "slack-bot-token",
      },
    });

    const response = await fixture.request("/v1/integration/connections", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(200);
    const body = ListIntegrationConnectionsResponseSchema.parse(await response.json());

    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "icn_slack_support",
          supportsWebhookSources: true,
        }),
      ]),
    );
  });

  it("returns 400 for invalid list query payload", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-list-validation@example.com",
    });

    const response = await fixture.request("/v1/integration/connections?after=abc&before=def", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(400);

    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body).toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("deletes an unbound connection and blocks deleting a bound connection", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "integration-connections-delete@example.com",
    });

    await ensureGitHubCloudTarget(fixture);

    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_delete_free",
        organizationId: session.organizationId,
        targetKey: "github_cloud",
        displayName: "Free connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      },
      {
        id: "icn_delete_bound",
        organizationId: session.organizationId,
        targetKey: "github_cloud",
        displayName: "Bound connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      },
      {
        id: "icn_delete_automation",
        organizationId: session.organizationId,
        targetKey: "github_cloud",
        displayName: "Automation connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      },
    ]);

    await insertBindingUsage(fixture, {
      organizationId: session.organizationId,
      profileId: "spf_delete",
      profileDisplayName: "Delete test profile",
      bindingId: "ibd_delete_bound",
      connectionId: "icn_delete_bound",
    });

    const organizationCredentialKey = await fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.organizationId, session.organizationId), eq(table.version, 1)),
    });

    if (organizationCredentialKey === undefined) {
      throw new Error("Expected organization credential key for delete integration test.");
    }

    await fixture.db.insert(integrationCredentials).values({
      id: "icr_delete_free",
      organizationId: session.organizationId,
      secretKind: IntegrationCredentialSecretKinds.API_KEY,
      ciphertext: "ciphertext-delete-free",
      nonce: "nonce-delete-free",
      organizationCredentialKeyVersion: organizationCredentialKey.version,
      intendedFamilyId: "github",
    });

    await fixture.db.insert(integrationConnectionCredentials).values({
      connectionId: "icn_delete_free",
      credentialId: "icr_delete_free",
      slotKey: "github.github-cloud.api-key.api-key",
    });
    await fixture.db.insert(integrationCredentials).values({
      id: "icr_delete_free_webhook_secret",
      organizationId: session.organizationId,
      secretKind: IntegrationCredentialSecretKinds.WEBHOOK_SECRET,
      ciphertext: "ciphertext",
      nonce: "nonce",
      organizationCredentialKeyVersion: 1,
      intendedFamilyId: "github",
    });
    await fixture.db.insert(integrationWebhookSources).values({
      id: "iws_delete_free",
      organizationId: session.organizationId,
      integrationConnectionId: "icn_delete_free",
      targetKey: "github_cloud",
      endpointKey: "ep_delete_free",
      webhookSecretCredentialId: "icr_delete_free_webhook_secret",
      status: "active",
    });

    await insertWebhookAutomationUsage(fixture, {
      organizationId: session.organizationId,
      automationId: "atm_delete_automation",
      automationName: "Delete guard automation",
      connectionId: "icn_delete_automation",
      targetKey: "github_cloud",
      eventTypes: ["issue_comment.created"],
      payloadFilter: {
        "issue_comment.created": {
          op: "eq",
          path: ["action"],
          value: "created",
        },
      },
    });

    const deleteFreeResponse = await fixture.request(
      "/v1/integration/connections/icn_delete_free",
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(deleteFreeResponse.status).toBe(200);
    expect(await deleteFreeResponse.json()).toEqual({
      connectionId: "icn_delete_free",
    });

    const deletedConnection = await fixture.db.query.integrationConnections.findFirst({
      where: (table, { eq }) => eq(table.id, "icn_delete_free"),
    });
    expect(deletedConnection).toBeUndefined();

    const deletedCredentialLink = await fixture.db.query.integrationConnectionCredentials.findFirst(
      {
        where: (table, { and, eq }) =>
          and(eq(table.connectionId, "icn_delete_free"), eq(table.credentialId, "icr_delete_free")),
      },
    );
    expect(deletedCredentialLink).toBeUndefined();

    const deletedCredential = await fixture.db.query.integrationCredentials.findFirst({
      where: (table, { eq }) => eq(table.id, "icr_delete_free"),
    });
    expect(deletedCredential).toBeUndefined();

    const deletedWebhookSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { eq }) => eq(table.id, "iws_delete_free"),
    });
    expect(deletedWebhookSource).toBeUndefined();

    const deletedWebhookSecretCredential = await fixture.db.query.integrationCredentials.findFirst({
      where: (table, { eq }) => eq(table.id, "icr_delete_free_webhook_secret"),
    });
    expect(deletedWebhookSecretCredential).toBeUndefined();

    const deleteBoundResponse = await fixture.request(
      "/v1/integration/connections/icn_delete_bound",
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(deleteBoundResponse.status).toBe(409);
    expect(await deleteBoundResponse.json()).toEqual({
      code: "CONNECTION_HAS_BINDINGS",
      message:
        "This integration connection cannot be deleted while it is still used by one or more bindings.",
    });

    const boundConnection = await fixture.db.query.integrationConnections.findFirst({
      where: (table, { eq }) => eq(table.id, "icn_delete_bound"),
    });
    expect(boundConnection).toBeDefined();

    const deleteAutomationResponse = await fixture.request(
      "/v1/integration/connections/icn_delete_automation",
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(deleteAutomationResponse.status).toBe(409);
    expect(await deleteAutomationResponse.json()).toEqual({
      code: "CONNECTION_HAS_AUTOMATIONS",
      message:
        "This integration connection cannot be deleted while it is still used by one or more webhook automations.",
    });

    const automationConnection = await fixture.db.query.integrationConnections.findFirst({
      where: (table, { eq }) => eq(table.id, "icn_delete_automation"),
    });
    expect(automationConnection).toBeDefined();

    const persistedWebhookAutomation = await fixture.db.query.webhookAutomations.findFirst({
      where: (table, { eq }) => eq(table.automationId, "atm_delete_automation"),
    });
    expect(persistedWebhookAutomation).toBeDefined();
  });

  it("returns 401 when the request is unauthenticated", async ({ fixture }) => {
    const response = await fixture.request("/v1/integration/connections");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  });
});

async function ensureListTargets(fixture: ControlPlaneApiIntegrationFixture): Promise<void> {
  await fixture.db
    .insert(integrationTargets)
    .values([
      {
        targetKey: "github_cloud",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      },
      {
        targetKey: "openai-default",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com",
        },
      },
    ])
    .onConflictDoNothing();
}

async function ensureGitHubCloudTarget(fixture: ControlPlaneApiIntegrationFixture): Promise<void> {
  await fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: "github_cloud",
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    })
    .onConflictDoNothing();
}

async function insertBindingUsage(
  fixture: ControlPlaneApiIntegrationFixture,
  input: {
    organizationId: string;
    profileId: string;
    profileDisplayName: string;
    bindingId: string;
    connectionId: string;
  },
): Promise<void> {
  await fixture.db.insert(sandboxProfiles).values({
    id: input.profileId,
    organizationId: input.organizationId,
    displayName: input.profileDisplayName,
  });
  await fixture.db.insert(sandboxProfileVersions).values({
    sandboxProfileId: input.profileId,
    version: 1,
  });
  await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
    id: input.bindingId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: 1,
    connectionId: input.connectionId,
    kind: "git",
    config: {},
  });
}

async function insertWebhookAutomationUsage(
  fixture: ControlPlaneApiIntegrationFixture,
  input: {
    organizationId: string;
    automationId: string;
    automationName: string;
    connectionId: string;
    targetKey: string;
    eventTypes: string[];
    payloadFilter: Record<string, unknown>;
  },
): Promise<void> {
  await fixture.db.insert(automations).values({
    id: input.automationId,
    organizationId: input.organizationId,
    kind: AutomationKinds.WEBHOOK,
    name: input.automationName,
    enabled: true,
  });
  await fixture.db.insert(integrationWebhookSources).values({
    id: `iws_${input.automationId}`,
    organizationId: input.organizationId,
    integrationConnectionId: input.connectionId,
    targetKey: input.targetKey,
    endpointKey: `ep_${input.automationId}`,
    status: "active",
  });
  await fixture.db.insert(webhookAutomations).values({
    automationId: input.automationId,
    integrationWebhookSourceId: `iws_${input.automationId}`,
    eventTypes: input.eventTypes,
    payloadFilter: input.payloadFilter,
    inputTemplate: "Handle payload",
    conversationKeyTemplate: "conversation",
    idempotencyKeyTemplate: "dedupe",
  });
}
