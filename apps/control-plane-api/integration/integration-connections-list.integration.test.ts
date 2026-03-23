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
  integrationTargets,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  webhookAutomations,
} from "@mistle/db/control-plane";
import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";
import { describe, expect } from "vitest";

import { ListIntegrationConnectionsResponseSchema } from "../src/integration-connections/list-integration-connections/schema.js";
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

    await fixture.db
      .insert(integrationTargets)
      .values([
        {
          targetKey: "github_cloud",
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            base_url: "https://github.com",
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
          base_url: "https://github.com",
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

    await fixture.db.insert(sandboxProfiles).values({
      id: "spf_001",
      organizationId: firstOrgSession.organizationId,
      displayName: "Profile 1",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "spf_001",
      version: 1,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_001",
      sandboxProfileId: "spf_001",
      sandboxProfileVersion: 1,
      connectionId: "icn_001",
      kind: "git",
      config: {},
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
        externalSubjectId: "github-user-1",
        config: {
          installation_id: "12345",
        },
        targetSnapshotConfig: {
          base_url: "https://github.com",
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
        createdAt: firstConnectionCreatedAt.toISOString(),
        updatedAt: firstConnectionCreatedAt.toISOString(),
      },
      {
        id: "icn_002",
        targetKey: "openai-default",
        displayName: "OpenAI Backup",
        status: IntegrationConnectionStatuses.ERROR,
        bindingCount: 0,
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

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "github_cloud",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          base_url: "https://github.com",
        },
      })
      .onConflictDoNothing();

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

    await fixture.db.insert(sandboxProfiles).values({
      id: "spf_delete",
      organizationId: session.organizationId,
      displayName: "Delete test profile",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "spf_delete",
      version: 1,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_delete_bound",
      sandboxProfileId: "spf_delete",
      sandboxProfileVersion: 1,
      connectionId: "icn_delete_bound",
      kind: "git",
      config: {},
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
      purpose: "api_key",
    });

    await fixture.db.insert(automations).values({
      id: "atm_delete_automation",
      organizationId: session.organizationId,
      kind: AutomationKinds.WEBHOOK,
      name: "Delete guard automation",
      enabled: true,
    });

    await fixture.db.insert(webhookAutomations).values({
      automationId: "atm_delete_automation",
      integrationConnectionId: "icn_delete_automation",
      eventTypes: ["issue_comment.created"],
      payloadFilter: {
        action: "created",
      },
      inputTemplate: "Handle payload",
      conversationKeyTemplate: "conversation",
      idempotencyKeyTemplate: "dedupe",
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
