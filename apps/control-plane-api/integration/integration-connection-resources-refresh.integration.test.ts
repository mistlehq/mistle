import {
  integrationConnections,
  integrationConnectionResourceStates,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
  integrationTargets,
} from "@mistle/db/control-plane";
import { SyncIntegrationConnectionResourcesWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { and, eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { RefreshAllIntegrationConnectionResourcesResponseSchema } from "../src/integration-connections/refresh-all-integration-connection-resources/schema.js";
import { RefreshIntegrationConnectionResourcesResponseSchema } from "../src/integration-connections/refresh-integration-connection-resources/schema.js";
import { countControlPlaneWorkflowRuns } from "./helpers/workflow-runs.js";
import { it } from "./test-context.js";

const GitHubRefreshAllConnectionId = "icn_refresh_all_001";
const GitHubRefreshAllResourcesPath = `/v1/integration/connections/${GitHubRefreshAllConnectionId}/resources/refresh`;
const GitHubRefreshAllResourceKinds: readonly ["repository", "branch", "user"] = [
  "repository",
  "branch",
  "user",
];
const SortedGitHubRefreshAllResourceKinds = [...GitHubRefreshAllResourceKinds].sort();

describe("integration connection resources refresh integration", () => {
  it("returns accepted, enqueues one sync for every supported resource kind, and reuses in-flight syncs", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "integration-connection-all-resources-refresh@example.com",
    });

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "github_cloud_all_refresh",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          base_url: "https://github.com",
        },
      })
      .onConflictDoNothing();

    await fixture.db.insert(integrationConnections).values({
      id: GitHubRefreshAllConnectionId,
      organizationId: session.organizationId,
      targetKey: "github_cloud_all_refresh",
      displayName: "GitHub Refresh All",
      status: IntegrationConnectionStatuses.ACTIVE,
      createdAt: "2026-03-09T00:00:00.000Z",
      updatedAt: "2026-03-09T00:00:00.000Z",
    });

    const firstResponse = await fixture.request(GitHubRefreshAllResourcesPath, {
      method: "POST",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(firstResponse.status).toBe(202);
    const firstBody = RefreshAllIntegrationConnectionResourcesResponseSchema.parse(
      await firstResponse.json(),
    );
    expect(firstBody).toEqual({
      connectionId: GitHubRefreshAllConnectionId,
      familyId: "github",
      resources: GitHubRefreshAllResourceKinds.map((kind) => ({
        kind,
        syncState: IntegrationConnectionResourceSyncStates.SYNCING,
      })),
    });

    for (const kind of GitHubRefreshAllResourceKinds) {
      const workflowRunCount = await countControlPlaneWorkflowRuns({
        databaseUrl: fixture.databaseStack.directUrl,
        workflowName: SyncIntegrationConnectionResourcesWorkflowSpec.name,
        inputEquals: {
          organizationId: session.organizationId,
          connectionId: GitHubRefreshAllConnectionId,
          kind,
        },
      });
      expect(workflowRunCount).toBe(1);
    }

    const persistedStates = await fixture.db.query.integrationConnectionResourceStates.findMany({
      where: (table, { eq }) => eq(table.connectionId, GitHubRefreshAllConnectionId),
      orderBy: (table, { asc }) => [asc(table.kind)],
    });
    expect(persistedStates.map((state) => state.kind)).toEqual(SortedGitHubRefreshAllResourceKinds);
    for (const persistedState of persistedStates) {
      expect(persistedState.familyId).toBe("github");
      expect(persistedState.syncState).toBe(IntegrationConnectionResourceSyncStates.SYNCING);
      expect(persistedState.lastSyncStartedAt).toBeTruthy();
      expect(persistedState.lastErrorCode).toBeNull();
      expect(persistedState.lastErrorMessage).toBeNull();
    }

    const secondResponse = await fixture.request(GitHubRefreshAllResourcesPath, {
      method: "POST",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(secondResponse.status).toBe(202);
    RefreshAllIntegrationConnectionResourcesResponseSchema.parse(await secondResponse.json());

    for (const kind of GitHubRefreshAllResourceKinds) {
      const workflowRunCount = await countControlPlaneWorkflowRuns({
        databaseUrl: fixture.databaseStack.directUrl,
        workflowName: SyncIntegrationConnectionResourcesWorkflowSpec.name,
        inputEquals: {
          organizationId: session.organizationId,
          connectionId: GitHubRefreshAllConnectionId,
          kind,
        },
      });
      expect(workflowRunCount).toBe(1);
    }
  });

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

  it("accepts refresh requests for Slack channel resources", async ({ fixture }) => {
    const session = await fixture.authSession({
      email: "integration-connection-resources-refresh-slack@example.com",
    });

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "slack_default",
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          api_base_url: "https://slack.com/api",
        },
      })
      .onConflictDoNothing();

    await fixture.db.insert(integrationConnections).values({
      id: "icn_refresh_slack_channel",
      organizationId: session.organizationId,
      targetKey: "slack_default",
      displayName: "Slack Refresh",
      status: IntegrationConnectionStatuses.ACTIVE,
      createdAt: "2026-03-09T00:00:00.000Z",
      updatedAt: "2026-03-09T00:00:00.000Z",
      config: {
        connection_method: "slack-bot-token",
      },
    });

    const response = await fixture.request(
      "/v1/integration/connections/icn_refresh_slack_channel/resources/channel/refresh",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(202);
    const body = RefreshIntegrationConnectionResourcesResponseSchema.parse(await response.json());
    expect(body).toEqual({
      connectionId: "icn_refresh_slack_channel",
      familyId: "slack",
      kind: "channel",
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
    });
  });
});
