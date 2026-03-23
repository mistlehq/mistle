import {
  integrationConnectionResources,
  integrationConnectionResourceStates,
  integrationConnections,
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
  integrationTargets,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import { ListIntegrationConnectionResourcesResponseSchema } from "../src/integration-connections/list-integration-connection-resources/schema.js";
import { IntegrationConnectionsConflictResponseSchema } from "../src/integration-connections/schemas.js";
import { it, type ControlPlaneApiIntegrationFixture } from "./test-context.js";

describe("integration connection resources list integration", () => {
  it("returns accessible resources for a ready snapshot and supports search and pagination", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "integration-connection-resources-ready@example.com",
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

    await fixture.db.insert(integrationConnections).values({
      id: "icn_ready",
      organizationId: session.organizationId,
      targetKey: "github_cloud",
      displayName: "GitHub Ready",
      status: IntegrationConnectionStatuses.ACTIVE,
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    await fixture.db.insert(integrationConnectionResourceStates).values({
      connectionId: "icn_ready",
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

    await fixture.db.insert(integrationConnectionResources).values([
      {
        id: "rsc_001",
        connectionId: "icn_ready",
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
        id: "rsc_002",
        connectionId: "icn_ready",
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
        id: "rsc_003",
        connectionId: "icn_ready",
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

    const firstResponse = await fixture.request(
      "/v1/integration/connections/icn_ready/resources?kind=repository&limit=1",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(firstResponse.status).toBe(200);
    const firstPage = ListIntegrationConnectionResourcesResponseSchema.parse(
      await firstResponse.json(),
    );

    expect(firstPage).toEqual({
      connectionId: "icn_ready",
      familyId: "github",
      kind: "repository",
      syncState: IntegrationConnectionResourceSyncStates.READY,
      lastSyncedAt: "2026-02-02T00:00:00.000Z",
      items: [
        {
          id: "rsc_001",
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

    const searchResponse = await fixture.request(
      "/v1/integration/connections/icn_ready/resources?kind=repository&search=beta",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(searchResponse.status).toBe(200);
    const searchPage = ListIntegrationConnectionResourcesResponseSchema.parse(
      await searchResponse.json(),
    );

    expect(searchPage.items.map((item) => item.handle)).toEqual(["mistlehq/beta"]);
    expect(searchPage.page.totalResults).toBe(1);
  });

  it("returns the last successful snapshot while a sync is in progress", async ({ fixture }) => {
    const session = await fixture.authSession({
      email: "integration-connection-resources-syncing@example.com",
    });

    await seedGithubConnectionWithState({
      fixture,
      organizationId: session.organizationId,
      connectionId: "icn_syncing",
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
      lastSyncedAt: "2026-02-05T00:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
    });

    const response = await fixture.request(
      "/v1/integration/connections/icn_syncing/resources?kind=repository",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = ListIntegrationConnectionResourcesResponseSchema.parse(await response.json());

    expect(body.syncState).toBe(IntegrationConnectionResourceSyncStates.SYNCING);
    expect(body.items.map((item) => item.handle)).toEqual(["mistlehq/sample"]);
  });

  it("returns the last successful snapshot and safe error details when the latest sync failed", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "integration-connection-resources-error@example.com",
    });

    await seedGithubConnectionWithState({
      fixture,
      organizationId: session.organizationId,
      connectionId: "icn_error",
      syncState: IntegrationConnectionResourceSyncStates.ERROR,
      lastSyncedAt: "2026-02-06T00:00:00.000Z",
      lastErrorCode: "RATE_LIMITED",
      lastErrorMessage: "GitHub API rate limit exceeded.",
    });

    const response = await fixture.request(
      "/v1/integration/connections/icn_error/resources?kind=repository",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = ListIntegrationConnectionResourcesResponseSchema.parse(await response.json());

    expect(body.syncState).toBe(IntegrationConnectionResourceSyncStates.ERROR);
    expect(body.lastErrorCode).toBe("RATE_LIMITED");
    expect(body.lastErrorMessage).toBe("GitHub API rate limit exceeded.");
    expect(body.items.map((item) => item.handle)).toEqual(["mistlehq/sample"]);
  });

  it("returns conflict errors when no readable snapshot exists yet", async ({ fixture }) => {
    const session = await fixture.authSession({
      email: "integration-connection-resources-conflicts@example.com",
    });

    await seedGithubTarget(fixture);

    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_never_synced",
        organizationId: session.organizationId,
        targetKey: "github_cloud",
        displayName: "Never Synced",
        status: IntegrationConnectionStatuses.ACTIVE,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "icn_syncing_no_snapshot",
        organizationId: session.organizationId,
        targetKey: "github_cloud",
        displayName: "Syncing",
        status: IntegrationConnectionStatuses.ACTIVE,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "icn_error_no_snapshot",
        organizationId: session.organizationId,
        targetKey: "github_cloud",
        displayName: "Error",
        status: IntegrationConnectionStatuses.ACTIVE,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
    ]);

    await fixture.db.insert(integrationConnectionResourceStates).values([
      {
        connectionId: "icn_syncing_no_snapshot",
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
        connectionId: "icn_error_no_snapshot",
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

    const neverSyncedResponse = await fixture.request(
      "/v1/integration/connections/icn_never_synced/resources?kind=repository",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(neverSyncedResponse.status).toBe(409);
    expect(
      IntegrationConnectionsConflictResponseSchema.parse(await neverSyncedResponse.json()),
    ).toEqual({
      code: "RESOURCE_SYNC_REQUIRED",
      message: "Resource sync is required before resources can be listed.",
    });

    const syncingResponse = await fixture.request(
      "/v1/integration/connections/icn_syncing_no_snapshot/resources?kind=repository",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(syncingResponse.status).toBe(409);
    expect(
      IntegrationConnectionsConflictResponseSchema.parse(await syncingResponse.json()),
    ).toEqual({
      code: "RESOURCE_SYNC_IN_PROGRESS",
      message: "Resource sync is still in progress and no previous snapshot is available yet.",
    });

    const errorResponse = await fixture.request(
      "/v1/integration/connections/icn_error_no_snapshot/resources?kind=repository",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(errorResponse.status).toBe(409);
    expect(IntegrationConnectionsConflictResponseSchema.parse(await errorResponse.json())).toEqual({
      code: "RESOURCE_SYNC_FAILED",
      message: "Resource sync failed before any usable snapshot was stored.",
      lastErrorCode: "AUTH_FAILED",
      lastErrorMessage: "The provider rejected the credential.",
    });
  });
});

async function seedGithubTarget(fixture: ControlPlaneApiIntegrationFixture) {
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
}

async function seedGithubConnectionWithState(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  connectionId: string;
  syncState: (typeof IntegrationConnectionResourceSyncStates)[keyof typeof IntegrationConnectionResourceSyncStates];
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}) {
  await seedGithubTarget(input.fixture);

  await input.fixture.db.insert(integrationConnections).values({
    id: input.connectionId,
    organizationId: input.organizationId,
    targetKey: "github_cloud",
    displayName: "GitHub Sample",
    status: IntegrationConnectionStatuses.ACTIVE,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  });

  await input.fixture.db.insert(integrationConnectionResourceStates).values({
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

  await input.fixture.db.insert(integrationConnectionResources).values({
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
