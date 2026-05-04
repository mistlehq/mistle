/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  AutomationKinds,
  IntegrationBindingKinds,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
  OrganizationIdentityLinkProviderConfigStatus,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { ListIntegrationConnectionsResponseSchema } from "../src/integration-connections/list-integration-connections/schema.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration connections list integration", () => {
  it("returns keyset paginated integration connections scoped to active organization", async ({
    env,
  }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-connections-list-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-connections-list-org-b@example.com",
    });

    await seedTarget(env, {
      targetKey: "github_cloud_connections_list",
      familyId: "github",
      variantId: "github-cloud",
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    });
    await seedTarget(env, {
      targetKey: "openai_connections_list",
      familyId: "openai",
      variantId: "openai-default",
      config: {
        api_base_url: "https://api.openai.com",
      },
    });

    const firstConnectionCreatedAt = new Date("2026-01-01T00:00:00.000Z");
    const secondConnectionCreatedAt = new Date("2026-01-02T00:00:00.000Z");
    const thirdConnectionCreatedAt = new Date("2026-01-03T00:00:00.000Z");

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values([
      {
        id: "icn_integration_new_list_001",
        organizationId: firstOrgSession.organizationId,
        targetKey: "github_cloud_connections_list",
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
        createdAt: firstConnectionCreatedAt,
        updatedAt: firstConnectionCreatedAt,
      },
      {
        id: "icn_integration_new_list_002",
        organizationId: firstOrgSession.organizationId,
        targetKey: "openai_connections_list",
        displayName: "OpenAI Backup",
        status: IntegrationConnectionStatuses.ERROR,
        createdAt: secondConnectionCreatedAt,
        updatedAt: secondConnectionCreatedAt,
      },
      {
        id: "icn_integration_new_list_003",
        organizationId: firstOrgSession.organizationId,
        targetKey: "github_cloud_connections_list",
        displayName: "GitHub Revoked",
        status: IntegrationConnectionStatuses.REVOKED,
        createdAt: thirdConnectionCreatedAt,
        updatedAt: thirdConnectionCreatedAt,
      },
      {
        id: "icn_integration_new_list_other_org",
        organizationId: secondOrgSession.organizationId,
        targetKey: "github_cloud_connections_list",
        displayName: "Other Org",
        status: IntegrationConnectionStatuses.ACTIVE,
        createdAt: thirdConnectionCreatedAt,
        updatedAt: thirdConnectionCreatedAt,
      },
    ]);

    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceStates)
      .values({
        connectionId: "icn_integration_new_list_001",
        familyId: "github",
        kind: "repository",
        syncState: IntegrationConnectionResourceSyncStates.READY,
        totalCount: 7,
        lastSyncedAt: new Date("2026-01-04T00:00:00.000Z"),
        lastSyncStartedAt: new Date("2026-01-04T00:00:00.000Z"),
        lastSyncFinishedAt: new Date("2026-01-04T00:00:00.000Z"),
        lastErrorCode: null,
        lastErrorMessage: null,
      });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.organizationIdentityLinkProviderConfigs)
      .values({
        id: "ilp_integration_new_list_001",
        organizationId: firstOrgSession.organizationId,
        providerFamily: "github",
        status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        integrationTargetKey: "github_cloud_connections_list",
        integrationConnectionId: "icn_integration_new_list_001",
        createdByUserId: firstOrgSession.userId,
        updatedByUserId: firstOrgSession.userId,
      });
    await seedBindingUsage(env, {
      organizationId: firstOrgSession.organizationId,
      profileId: "spf_integration_new_list_001",
      profileDisplayName: "Profile 1",
      bindingId: "ibd_integration_new_list_001",
      connectionId: "icn_integration_new_list_001",
      activeVersion: 1,
    });
    await seedWebhookAutomationUsage(env, {
      organizationId: firstOrgSession.organizationId,
      automationId: "atm_integration_new_list_001",
      automationName: "GitHub webhook automation",
      connectionId: "icn_integration_new_list_002",
      targetKey: "openai_connections_list",
      eventTypes: ["response.created"],
      payloadFilter: {
        "response.created": {
          op: "eq",
          path: ["type"],
          value: "response.created",
        },
      },
    });

    const firstPage = await listConnections({
      cookie: firstOrgSession.cookie,
      env,
      query: "limit=2",
    });

    expect(firstPage.totalResults).toBe(3);
    expect(normalizeConnectionTimestamps(firstPage.items)).toEqual([
      {
        id: "icn_integration_new_list_001",
        targetKey: "github_cloud_connections_list",
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
        id: "icn_integration_new_list_002",
        targetKey: "openai_connections_list",
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

    const secondPage = await listConnections({
      cookie: firstOrgSession.cookie,
      env,
      query: `limit=2&after=${encodeURIComponent(firstPage.nextPage.after)}`,
    });
    expect(secondPage.totalResults).toBe(3);
    expect(normalizeConnectionTimestamps(secondPage.items)).toEqual([
      {
        id: "icn_integration_new_list_003",
        targetKey: "github_cloud_connections_list",
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

    const previousPage = await listConnections({
      cookie: firstOrgSession.cookie,
      env,
      query: `limit=2&before=${encodeURIComponent(secondPage.previousPage.before)}`,
    });
    expect(previousPage.items.map((connection) => connection.id)).toEqual([
      "icn_integration_new_list_001",
      "icn_integration_new_list_002",
    ]);
  });

  it("returns 400 for invalid pagination cursor", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connections-list-invalid-cursor@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/integration/connections?after=invalid-cursor",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain('"code":"INVALID_PAGINATION_CURSOR"');
  });

  it("reports webhook-source support per connection for mixed GitHub auth methods", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connections-list-github-webhook-support@example.com",
    });

    await seedTarget(env, {
      targetKey: "github_cloud_webhook_support_integration_new",
      familyId: "github",
      variantId: "github-cloud",
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values([
      {
        id: "icn_integration_new_github_app_support",
        organizationId: session.organizationId,
        targetKey: "github_cloud_webhook_support_integration_new",
        displayName: "GitHub App",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          app_id: "123",
          app_slug: "mistle-github-app",
        },
      },
      {
        id: "icn_integration_new_github_api_key_no_support",
        organizationId: session.organizationId,
        targetKey: "github_cloud_webhook_support_integration_new",
        displayName: "GitHub API key",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
    ]);

    const body = await listConnections({
      cookie: session.cookie,
      env,
      query: "",
    });

    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "icn_integration_new_github_app_support",
          connectionMethodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          connectionMethodLabel: "GitHub App installation",
          supportsWebhookSources: true,
        }),
        expect.objectContaining({
          id: "icn_integration_new_github_api_key_no_support",
          connectionMethodId: IntegrationConnectionMethodIds.API_KEY,
          connectionMethodLabel: "API key",
          supportsWebhookSources: false,
        }),
      ]),
    );
  });

  it("returns auth method metadata resolved from the integration definition", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connections-list-jira-auth-method@example.com",
    });

    await seedTarget(env, {
      targetKey: "jira_default_auth_method_integration_new",
      familyId: "jira",
      variantId: "jira-default",
      config: {
        site_url: "https://mistle.atlassian.net",
        cloud_id: "cloud_123",
      },
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
      id: "icn_integration_new_jira_service_account",
      organizationId: session.organizationId,
      targetKey: "jira_default_auth_method_integration_new",
      displayName: "Jira service account",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "jira-service-account-api-token",
      },
    });

    const body = await listConnections({
      cookie: session.cookie,
      env,
      query: "",
    });

    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "icn_integration_new_jira_service_account",
          connectionMethodId: "jira-service-account-api-token",
          connectionMethodLabel: "Service account API token",
        }),
      ]),
    );
  });

  it("reports webhook-source support for Slack implicit webhook connections", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connections-list-slack-webhook-support@example.com",
    });

    await seedTarget(env, {
      targetKey: "slack_default_integration_new",
      familyId: "slack",
      variantId: "slack-default",
      config: {
        api_base_url: "https://slack.com/api",
      },
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
      id: "icn_integration_new_slack_support",
      organizationId: session.organizationId,
      targetKey: "slack_default_integration_new",
      displayName: "Slack webhook connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "slack-bot-token",
      },
    });

    const body = await listConnections({
      cookie: session.cookie,
      env,
      query: "",
    });

    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "icn_integration_new_slack_support",
          supportsWebhookSources: true,
        }),
      ]),
    );
  });

  it("returns 400 for invalid list query payload", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connections-list-validation@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/integration/connections?after=abc&before=def",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(response.status).toBe(400);

    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body).toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("returns 401 when the request is unauthenticated", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch("/v1/integration/connections");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  });
});

type IntegrationConnectionsPage = ReturnType<typeof ListIntegrationConnectionsResponseSchema.parse>;

async function seedTarget(
  env: IntegrationTestEnvironment,
  input: {
    targetKey: string;
    familyId: string;
    variantId: string;
    config: Record<string, unknown>;
  },
): Promise<void> {
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: input.familyId,
      variantId: input.variantId,
      enabled: true,
      config: input.config,
    })
    .onConflictDoUpdate({
      target: env.controlPlaneTables.integrationTargets.targetKey,
      set: {
        familyId: input.familyId,
        variantId: input.variantId,
        enabled: true,
        config: input.config,
      },
    });
}

async function listConnections(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  query: string;
}): Promise<IntegrationConnectionsPage> {
  const querySuffix = input.query.length === 0 ? "" : `?${input.query}`;
  const response = await input.env.controlPlaneApi.http.fetch(
    `/v1/integration/connections${querySuffix}`,
    {
      headers: {
        cookie: input.cookie,
      },
    },
  );
  expect(response.status).toBe(200);

  return ListIntegrationConnectionsResponseSchema.parse(await response.json());
}

function normalizeConnectionTimestamps(
  items: IntegrationConnectionsPage["items"],
): Array<IntegrationConnectionsPage["items"][number] & { createdAt: string; updatedAt: string }> {
  return items.map((item) => ({
    ...item,
    createdAt: new Date(item.createdAt).toISOString(),
    updatedAt: new Date(item.updatedAt).toISOString(),
  }));
}

async function seedBindingUsage(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    profileId: string;
    profileDisplayName: string;
    bindingId: string;
    connectionId: string;
    activeVersion?: number | null;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
    id: input.profileId,
    organizationId: input.organizationId,
    displayName: input.profileDisplayName,
    activeVersion: input.activeVersion,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
    sandboxProfileId: input.profileId,
    version: 1,
    state: SandboxProfileVersionStates.PUBLISHED,
    publishedAt: new Date("2026-03-01T00:00:00.000Z"),
  });
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values({
      id: input.bindingId,
      sandboxProfileId: input.profileId,
      sandboxProfileVersion: 1,
      connectionId: input.connectionId,
      kind: IntegrationBindingKinds.GIT,
      config: {},
    });
}

async function seedWebhookAutomationUsage(
  env: IntegrationTestEnvironment,
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
  await env.controlPlaneDb.insert(env.controlPlaneTables.automations).values({
    id: input.automationId,
    organizationId: input.organizationId,
    kind: AutomationKinds.WEBHOOK,
    name: input.automationName,
    enabled: true,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationWebhookSources).values({
    id: `iws_${input.automationId}`,
    organizationId: input.organizationId,
    integrationConnectionId: input.connectionId,
    targetKey: input.targetKey,
    endpointKey: `ep_${input.automationId}`,
    status: "active",
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.webhookAutomations).values({
    automationId: input.automationId,
    integrationWebhookSourceId: `iws_${input.automationId}`,
    eventTypes: input.eventTypes,
    payloadFilter: input.payloadFilter,
    inputTemplate: "Handle payload",
    conversationKeyTemplate: "conversation",
    idempotencyKeyTemplate: "dedupe",
  });
}
