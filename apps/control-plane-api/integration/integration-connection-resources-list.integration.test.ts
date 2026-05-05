/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  ListIntegrationConnectionResourcesConflictResponseSchema,
  ListIntegrationConnectionResourcesResponseSchema,
} from "../src/integration-connections/list-integration-connection-resources/schema.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration connection resources list integration", () => {
  it("returns accessible resources for a ready snapshot and supports search and pagination", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connection-resources-ready@example.com",
    });

    await seedGithubTarget(env);
    await seedGithubConnection(env, {
      connectionId: "icn_integration_new_resources_ready",
      displayName: "GitHub Ready",
      organizationId: session.organizationId,
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceStates)
      .values({
        connectionId: "icn_integration_new_resources_ready",
        familyId: "github",
        kind: "repository",
        syncState: IntegrationConnectionResourceSyncStates.READY,
        totalCount: 2,
        lastSyncedAt: "2026-02-02T00:00:00.000Z",
        lastSyncStartedAt: "2026-02-02T00:00:00.000Z",
        lastSyncFinishedAt: "2026-02-02T00:00:00.000Z",
        lastErrorCode: null,
        lastErrorMessage: null,
      });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnectionResources).values([
      {
        id: "rsc_integration_new_resources_ready_alpha",
        connectionId: "icn_integration_new_resources_ready",
        familyId: "github",
        kind: "repository",
        externalId: "1001",
        handle: "mistlehq/alpha",
        displayName: "mistlehq/alpha",
        status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
        metadata: {
          visibility: "private",
        },
        lastSeenAt: "2026-02-02T00:00:00.000Z",
      },
      {
        id: "rsc_integration_new_resources_ready_beta",
        connectionId: "icn_integration_new_resources_ready",
        familyId: "github",
        kind: "repository",
        externalId: "1002",
        handle: "mistlehq/beta",
        displayName: "mistlehq/beta",
        status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
        metadata: {
          visibility: "public",
        },
        lastSeenAt: "2026-02-02T00:00:00.000Z",
      },
      {
        id: "rsc_integration_new_resources_ready_gone",
        connectionId: "icn_integration_new_resources_ready",
        familyId: "github",
        kind: "repository",
        externalId: "1003",
        handle: "mistlehq/gone",
        displayName: "mistlehq/gone",
        status: IntegrationConnectionResourceStatuses.UNAVAILABLE,
        unavailableReason: "unknown",
        metadata: {
          visibility: "private",
        },
        lastSeenAt: "2026-02-01T00:00:00.000Z",
        removedAt: "2026-02-03T00:00:00.000Z",
      },
    ]);

    const firstPage = await listResources(env, {
      connectionId: "icn_integration_new_resources_ready",
      cookie: session.cookie,
      query: "kind=repository&limit=1",
    });

    expect(firstPage).toEqual({
      connectionId: "icn_integration_new_resources_ready",
      familyId: "github",
      kind: "repository",
      syncState: IntegrationConnectionResourceSyncStates.READY,
      lastSyncedAt: "2026-02-02T00:00:00.000Z",
      items: [
        {
          id: "rsc_integration_new_resources_ready_alpha",
          familyId: "github",
          kind: "repository",
          externalId: "1001",
          handle: "mistlehq/alpha",
          displayName: "mistlehq/alpha",
          status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
          metadata: {
            visibility: "private",
          },
        },
      ],
      page: {
        totalResults: 2,
        nextCursor: expect.any(String),
        previousCursor: null,
      },
    });

    const searchPage = await listResources(env, {
      connectionId: "icn_integration_new_resources_ready",
      cookie: session.cookie,
      query: "kind=repository&search=beta",
    });

    expect(searchPage.items.map((item) => item.handle)).toEqual(["mistlehq/beta"]);
    expect(searchPage.page.totalResults).toBe(1);
  });

  it("returns the last successful snapshot while a sync is in progress", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connection-resources-syncing@example.com",
    });

    await seedGithubConnectionWithState(env, {
      organizationId: session.organizationId,
      connectionId: "icn_integration_new_resources_syncing",
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
      lastSyncedAt: "2026-02-05T00:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
    });

    const page = await listResources(env, {
      connectionId: "icn_integration_new_resources_syncing",
      cookie: session.cookie,
      query: "kind=repository",
    });

    expect(page.syncState).toBe(IntegrationConnectionResourceSyncStates.SYNCING);
    expect(page.items.map((item) => item.handle)).toEqual(["mistlehq/sample"]);
  });

  it("returns the last successful snapshot and safe error details when the latest sync failed", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connection-resources-error@example.com",
    });

    await seedGithubConnectionWithState(env, {
      organizationId: session.organizationId,
      connectionId: "icn_integration_new_resources_error",
      syncState: IntegrationConnectionResourceSyncStates.ERROR,
      lastSyncedAt: "2026-02-06T00:00:00.000Z",
      lastErrorCode: "RATE_LIMITED",
      lastErrorMessage: "GitHub API rate limit exceeded.",
    });

    const page = await listResources(env, {
      connectionId: "icn_integration_new_resources_error",
      cookie: session.cookie,
      query: "kind=repository",
    });

    expect(page.syncState).toBe(IntegrationConnectionResourceSyncStates.ERROR);
    expect(page.lastErrorCode).toBe("RATE_LIMITED");
    expect(page.lastErrorMessage).toBe("GitHub API rate limit exceeded.");
    expect(page.items.map((item) => item.handle)).toEqual(["mistlehq/sample"]);
  });

  it("returns conflict errors when no readable snapshot exists yet", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connection-resources-conflicts@example.com",
    });

    await seedGithubTarget(env);
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values([
      {
        id: "icn_integration_new_resources_never_synced",
        organizationId: session.organizationId,
        targetKey: "github_cloud",
        displayName: "Never Synced",
        status: IntegrationConnectionStatuses.ACTIVE,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "icn_integration_new_resources_syncing_no_snapshot",
        organizationId: session.organizationId,
        targetKey: "github_cloud",
        displayName: "Syncing",
        status: IntegrationConnectionStatuses.ACTIVE,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "icn_integration_new_resources_error_no_snapshot",
        organizationId: session.organizationId,
        targetKey: "github_cloud",
        displayName: "Error",
        status: IntegrationConnectionStatuses.ACTIVE,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceStates)
      .values([
        {
          connectionId: "icn_integration_new_resources_syncing_no_snapshot",
          familyId: "github",
          kind: "repository",
          syncState: IntegrationConnectionResourceSyncStates.SYNCING,
          totalCount: 0,
          lastSyncedAt: null,
          lastSyncStartedAt: "2026-02-07T00:00:00.000Z",
          lastSyncFinishedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
        {
          connectionId: "icn_integration_new_resources_error_no_snapshot",
          familyId: "github",
          kind: "repository",
          syncState: IntegrationConnectionResourceSyncStates.ERROR,
          totalCount: 0,
          lastSyncedAt: null,
          lastSyncStartedAt: "2026-02-07T00:00:00.000Z",
          lastSyncFinishedAt: "2026-02-07T00:00:10.000Z",
          lastErrorCode: "AUTH_FAILED",
          lastErrorMessage: "The provider rejected the credential.",
        },
      ]);

    await expectResourceConflict(env, {
      connectionId: "icn_integration_new_resources_never_synced",
      cookie: session.cookie,
      expected: {
        code: "RESOURCE_SYNC_REQUIRED",
        message: "Resource sync is required before resources can be listed.",
      },
    });
    await expectResourceConflict(env, {
      connectionId: "icn_integration_new_resources_syncing_no_snapshot",
      cookie: session.cookie,
      expected: {
        code: "RESOURCE_SYNC_IN_PROGRESS",
        message: "Resource sync is still in progress and no previous snapshot is available yet.",
      },
    });
    await expectResourceConflict(env, {
      connectionId: "icn_integration_new_resources_error_no_snapshot",
      cookie: session.cookie,
      expected: {
        code: "RESOURCE_SYNC_FAILED",
        message: "Resource sync failed before any usable snapshot was stored.",
        lastErrorCode: "AUTH_FAILED",
        lastErrorMessage: "The provider rejected the credential.",
      },
    });
  });
});

type ResourceConflictExpectation = {
  code: "RESOURCE_SYNC_REQUIRED" | "RESOURCE_SYNC_IN_PROGRESS" | "RESOURCE_SYNC_FAILED";
  message: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
};

async function listResources(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    cookie: string;
    query: string;
  },
): Promise<ReturnType<typeof ListIntegrationConnectionResourcesResponseSchema.parse>> {
  const response = await env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${input.connectionId}/resources?${input.query}`,
    {
      headers: {
        cookie: input.cookie,
      },
    },
  );

  expect(response.status).toBe(200);
  return ListIntegrationConnectionResourcesResponseSchema.parse(await response.json());
}

async function expectResourceConflict(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    cookie: string;
    expected: ResourceConflictExpectation;
  },
): Promise<void> {
  const response = await env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${input.connectionId}/resources?kind=repository`,
    {
      headers: {
        cookie: input.cookie,
      },
    },
  );

  expect(response.status).toBe(409);
  expect(
    ListIntegrationConnectionResourcesConflictResponseSchema.parse(await response.json()),
  ).toEqual(input.expected);
}

async function seedGithubTarget(env: IntegrationTestEnvironment): Promise<void> {
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.integrationTargets)
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
}

async function seedGithubConnection(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    organizationId: string;
    displayName: string;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
    id: input.connectionId,
    organizationId: input.organizationId,
    targetKey: "github_cloud",
    displayName: input.displayName,
    status: IntegrationConnectionStatuses.ACTIVE,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  });
}

async function seedGithubConnectionWithState(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    connectionId: string;
    syncState: (typeof IntegrationConnectionResourceSyncStates)[keyof typeof IntegrationConnectionResourceSyncStates];
    lastSyncedAt: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
  },
): Promise<void> {
  await seedGithubTarget(env);
  await seedGithubConnection(env, {
    connectionId: input.connectionId,
    organizationId: input.organizationId,
    displayName: "GitHub Sample",
  });
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.integrationConnectionResourceStates)
    .values({
      connectionId: input.connectionId,
      familyId: "github",
      kind: "repository",
      syncState: input.syncState,
      totalCount: 1,
      lastSyncedAt: input.lastSyncedAt,
      lastSyncStartedAt: "2026-02-06T00:00:00.000Z",
      lastSyncFinishedAt: "2026-02-06T00:00:10.000Z",
      lastErrorCode: input.lastErrorCode,
      lastErrorMessage: input.lastErrorMessage,
    });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnectionResources).values({
    id: `rsc_${input.connectionId}`,
    connectionId: input.connectionId,
    familyId: "github",
    kind: "repository",
    externalId: `ext_${input.connectionId}`,
    handle: "mistlehq/sample",
    displayName: "mistlehq/sample",
    status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
    metadata: {
      visibility: "private",
    },
    lastSeenAt: "2026-02-06T00:00:00.000Z",
  });
}
