import { SyncIntegrationConnectionResourcesWorkflowSpec } from "@control-plane/workflows";
import {
  integrationConnections,
  integrationConnectionResourceStates,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
  integrationTargets,
} from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { RefreshIntegrationConnectionResourcesResponseSchema } from "../src/integration-connections/contracts.js";
import { countControlPlaneWorkflowRuns } from "./helpers/workflow-runs.js";
import { it } from "./test-context.js";

describe("integration connection resources refresh integration", () => {
  it("returns accepted, enqueues a resource sync once, and does not enqueue again while the resource is already syncing", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "integration-connection-resources-refresh@example.com",
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
      id: "icn_refresh_001",
      organizationId: session.organizationId,
      targetKey: "github_cloud",
      displayName: "GitHub Refresh",
      status: IntegrationConnectionStatuses.ACTIVE,
      createdAt: "2026-03-09T00:00:00.000Z",
      updatedAt: "2026-03-09T00:00:00.000Z",
    });

    const workflowRunCountBefore = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      workflowName: SyncIntegrationConnectionResourcesWorkflowSpec.name,
      inputEquals: {
        organizationId: session.organizationId,
        connectionId: "icn_refresh_001",
        kind: "repository",
      },
    });

    const firstResponse = await fixture.request(
      "/v1/integration/connections/icn_refresh_001/resources/repository/refresh",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(firstResponse.status).toBe(202);
    const firstBody = RefreshIntegrationConnectionResourcesResponseSchema.parse(
      await firstResponse.json(),
    );
    expect(firstBody).toEqual({
      connectionId: "icn_refresh_001",
      familyId: "github",
      kind: "repository",
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
    });

    const firstWorkflowRunCountAfter = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      workflowName: SyncIntegrationConnectionResourcesWorkflowSpec.name,
      inputEquals: {
        organizationId: session.organizationId,
        connectionId: "icn_refresh_001",
        kind: "repository",
      },
    });
    expect(firstWorkflowRunCountAfter).toBe(workflowRunCountBefore + 1);

    const persistedState = await fixture.db.query.integrationConnectionResourceStates.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.connectionId, "icn_refresh_001"), eq(table.kind, "repository")),
    });
    expect(persistedState).toBeDefined();
    if (persistedState === undefined) {
      throw new Error("Expected persisted resource state.");
    }

    expect(persistedState.syncState).toBe(IntegrationConnectionResourceSyncStates.SYNCING);
    expect(persistedState.familyId).toBe("github");
    expect(persistedState.lastSyncStartedAt).toBeTruthy();
    expect(persistedState.lastErrorCode).toBeNull();
    expect(persistedState.lastErrorMessage).toBeNull();

    const secondResponse = await fixture.request(
      "/v1/integration/connections/icn_refresh_001/resources/repository/refresh",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(secondResponse.status).toBe(202);
    RefreshIntegrationConnectionResourcesResponseSchema.parse(await secondResponse.json());

    const secondWorkflowRunCountAfter = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      workflowName: SyncIntegrationConnectionResourcesWorkflowSpec.name,
      inputEquals: {
        organizationId: session.organizationId,
        connectionId: "icn_refresh_001",
        kind: "repository",
      },
    });
    expect(secondWorkflowRunCountAfter).toBe(firstWorkflowRunCountAfter);

    const persistedStates = await fixture.db.query.integrationConnectionResourceStates.findMany({
      where: (table, { and, eq }) =>
        and(eq(table.connectionId, "icn_refresh_001"), eq(table.kind, "repository")),
    });
    expect(persistedStates).toHaveLength(1);
  });

  it("enqueues a fresh workflow run after the previous sync attempt is no longer syncing", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "integration-connection-resources-refresh-completed@example.com",
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
      id: "icn_refresh_002",
      organizationId: session.organizationId,
      targetKey: "github_cloud",
      displayName: "GitHub Refresh Completed",
      status: IntegrationConnectionStatuses.ACTIVE,
      createdAt: "2026-03-09T00:00:00.000Z",
      updatedAt: "2026-03-09T00:00:00.000Z",
    });

    const firstResponse = await fixture.request(
      "/v1/integration/connections/icn_refresh_002/resources/repository/refresh",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(firstResponse.status).toBe(202);

    const firstWorkflowRunCount = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      workflowName: SyncIntegrationConnectionResourcesWorkflowSpec.name,
      inputEquals: {
        organizationId: session.organizationId,
        connectionId: "icn_refresh_002",
        kind: "repository",
      },
    });
    expect(firstWorkflowRunCount).toBe(1);

    await fixture.db
      .update(integrationConnectionResourceStates)
      .set({
        syncState: IntegrationConnectionResourceSyncStates.READY,
        lastSyncedAt: "2026-03-09T00:05:00.000Z",
        lastSyncFinishedAt: "2026-03-09T00:05:00.000Z",
      })
      .where(
        and(
          eq(integrationConnectionResourceStates.connectionId, "icn_refresh_002"),
          eq(integrationConnectionResourceStates.kind, "repository"),
        ),
      );

    const secondResponse = await fixture.request(
      "/v1/integration/connections/icn_refresh_002/resources/repository/refresh",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(secondResponse.status).toBe(202);
    const secondBody = RefreshIntegrationConnectionResourcesResponseSchema.parse(
      await secondResponse.json(),
    );
    expect(secondBody).toEqual({
      connectionId: "icn_refresh_002",
      familyId: "github",
      kind: "repository",
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
    });

    const secondWorkflowRunCount = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      workflowName: SyncIntegrationConnectionResourcesWorkflowSpec.name,
      inputEquals: {
        organizationId: session.organizationId,
        connectionId: "icn_refresh_002",
        kind: "repository",
      },
    });
    expect(secondWorkflowRunCount).toBe(2);

    const persistedState = await fixture.db.query.integrationConnectionResourceStates.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.connectionId, "icn_refresh_002"), eq(table.kind, "repository")),
    });
    expect(persistedState).toBeDefined();
    if (persistedState === undefined) {
      throw new Error("Expected persisted resource state.");
    }

    expect(persistedState.syncState).toBe(IntegrationConnectionResourceSyncStates.SYNCING);
    expect(persistedState.lastSyncStartedAt).toBeTruthy();
  });
});
