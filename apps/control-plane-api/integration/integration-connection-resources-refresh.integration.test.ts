/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { SyncIntegrationConnectionResourcesWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

import { RefreshAllIntegrationConnectionResourcesResponseSchema } from "../src/integration-connections/refresh-all-integration-connection-resources/schema.js";
import { RefreshIntegrationConnectionResourcesResponseSchema } from "../src/integration-connections/refresh-integration-connection-resources/schema.js";

const GitHubResourceKinds: readonly ["repository", "branch", "user", "team"] = [
  "repository",
  "branch",
  "user",
  "team",
];
const CountRowSchema = z
  .object({
    count: z.string(),
  })
  .strict();
const SortedGitHubResourceKinds = [...GitHubResourceKinds].sort();

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration connection resources refresh integration", () => {
  it("enqueues one sync for every supported resource kind and reuses in-flight syncs", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connection-resources-refresh-all@example.com",
    });
    const connectionId = "icn_integration_new_resources_refresh_all";

    await seedIntegrationTarget(env, {
      targetKey: "github_cloud_all_refresh",
      familyId: "github",
      variantId: "github-cloud",
      config: {
        base_url: "https://github.com",
      },
    });
    await seedConnection(env, {
      connectionId,
      organizationId: session.organizationId,
      targetKey: "github_cloud_all_refresh",
      displayName: "GitHub Refresh All",
    });

    const firstResponse = await refreshAllResources(env, {
      connectionId,
      cookie: session.cookie,
    });

    expect(firstResponse).toEqual({
      connectionId,
      familyId: "github",
      resources: GitHubResourceKinds.map((kind) => ({
        kind,
        syncState: IntegrationConnectionResourceSyncStates.SYNCING,
      })),
    });
    await expectWorkflowRunCounts(env, {
      organizationId: session.organizationId,
      connectionId,
      kinds: GitHubResourceKinds,
      expectedCount: 1,
    });

    const persistedStates =
      await env.controlPlaneDb.query.integrationConnectionResourceStates.findMany({
        where: (table, { eq }) => eq(table.connectionId, connectionId),
        orderBy: (table, { asc }) => [asc(table.kind)],
      });
    expect(persistedStates.map((state) => state.kind)).toEqual(SortedGitHubResourceKinds);
    for (const persistedState of persistedStates) {
      expect(persistedState.familyId).toBe("github");
      expect(persistedState.syncState).toBe(IntegrationConnectionResourceSyncStates.SYNCING);
      expect(persistedState.lastSyncStartedAt).toBeTruthy();
      expect(persistedState.lastErrorCode).toBeNull();
      expect(persistedState.lastErrorMessage).toBeNull();
    }

    await refreshAllResources(env, {
      connectionId,
      cookie: session.cookie,
    });
    await expectWorkflowRunCounts(env, {
      organizationId: session.organizationId,
      connectionId,
      kinds: GitHubResourceKinds,
      expectedCount: 1,
    });
  });

  it("enqueues one resource sync and does not enqueue again while it is already syncing", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connection-resources-refresh-one@example.com",
    });
    const connectionId = "icn_integration_new_resources_refresh_one";

    await seedGithubConnection(env, {
      connectionId,
      organizationId: session.organizationId,
      displayName: "GitHub Refresh",
    });

    const firstResponse = await refreshResource(env, {
      connectionId,
      cookie: session.cookie,
      kind: "repository",
    });

    expect(firstResponse).toEqual({
      connectionId,
      familyId: "github",
      kind: "repository",
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
    });
    await expectWorkflowRunCount(env, {
      organizationId: session.organizationId,
      connectionId,
      kind: "repository",
      expectedCount: 1,
    });
    await expectPersistedResourceState(env, {
      connectionId,
      kind: "repository",
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
    });

    await refreshResource(env, {
      connectionId,
      cookie: session.cookie,
      kind: "repository",
    });
    await expectWorkflowRunCount(env, {
      organizationId: session.organizationId,
      connectionId,
      kind: "repository",
      expectedCount: 1,
    });

    const persistedStates =
      await env.controlPlaneDb.query.integrationConnectionResourceStates.findMany({
        where: (table, { and, eq }) =>
          and(eq(table.connectionId, connectionId), eq(table.kind, "repository")),
      });
    expect(persistedStates).toHaveLength(1);
  });

  it("enqueues a fresh workflow run after the previous sync attempt is no longer syncing", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connection-resources-refresh-completed@example.com",
    });
    const connectionId = "icn_integration_new_resources_refresh_completed";

    await seedGithubConnection(env, {
      connectionId,
      organizationId: session.organizationId,
      displayName: "GitHub Refresh Completed",
    });

    await refreshResource(env, {
      connectionId,
      cookie: session.cookie,
      kind: "repository",
    });
    await expectWorkflowRunCount(env, {
      organizationId: session.organizationId,
      connectionId,
      kind: "repository",
      expectedCount: 1,
    });

    await env.controlPlaneDb
      .update(env.controlPlaneTables.integrationConnectionResourceStates)
      .set({
        syncState: IntegrationConnectionResourceSyncStates.READY,
        lastSyncedAt: "2026-03-09T00:05:00.000Z",
        lastSyncFinishedAt: "2026-03-09T00:05:00.000Z",
      })
      .where(
        and(
          eq(env.controlPlaneTables.integrationConnectionResourceStates.connectionId, connectionId),
          eq(env.controlPlaneTables.integrationConnectionResourceStates.kind, "repository"),
        ),
      );

    const secondResponse = await refreshResource(env, {
      connectionId,
      cookie: session.cookie,
      kind: "repository",
    });

    expect(secondResponse).toEqual({
      connectionId,
      familyId: "github",
      kind: "repository",
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
    });
    await expectWorkflowRunCount(env, {
      organizationId: session.organizationId,
      connectionId,
      kind: "repository",
      expectedCount: 2,
    });
    await expectPersistedResourceState(env, {
      connectionId,
      kind: "repository",
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
    });
  });

  it("accepts refresh requests for Slack channel resources", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connection-resources-refresh-slack@example.com",
    });

    await seedIntegrationTarget(env, {
      targetKey: "slack_default",
      familyId: "slack",
      variantId: "slack-default",
      config: {
        api_base_url: "https://slack.com/api",
      },
    });
    await seedConnection(env, {
      connectionId: "icn_integration_new_resources_refresh_slack",
      organizationId: session.organizationId,
      targetKey: "slack_default",
      displayName: "Slack Refresh",
      config: {
        connection_method: "slack-bot-token",
      },
    });

    const response = await refreshResource(env, {
      connectionId: "icn_integration_new_resources_refresh_slack",
      cookie: session.cookie,
      kind: "channel",
    });

    expect(response).toEqual({
      connectionId: "icn_integration_new_resources_refresh_slack",
      familyId: "slack",
      kind: "channel",
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
    });
  });
});

type ResourceRefreshKind = "repository" | "branch" | "user" | "team" | "channel";

async function refreshAllResources(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    cookie: string;
  },
): Promise<ReturnType<typeof RefreshAllIntegrationConnectionResourcesResponseSchema.parse>> {
  const response = await env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${input.connectionId}/resources/refresh`,
    {
      method: "POST",
      headers: {
        cookie: input.cookie,
      },
    },
  );

  expect(response.status).toBe(202);
  return RefreshAllIntegrationConnectionResourcesResponseSchema.parse(await response.json());
}

async function refreshResource(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    cookie: string;
    kind: ResourceRefreshKind;
  },
): Promise<ReturnType<typeof RefreshIntegrationConnectionResourcesResponseSchema.parse>> {
  const response = await env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${input.connectionId}/resources/${input.kind}/refresh`,
    {
      method: "POST",
      headers: {
        cookie: input.cookie,
      },
    },
  );

  expect(response.status).toBe(202);
  return RefreshIntegrationConnectionResourcesResponseSchema.parse(await response.json());
}

async function expectWorkflowRunCounts(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    connectionId: string;
    kinds: readonly ResourceRefreshKind[];
    expectedCount: number;
  },
): Promise<void> {
  for (const kind of input.kinds) {
    await expectWorkflowRunCount(env, {
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      kind,
      expectedCount: input.expectedCount,
    });
  }
}

async function expectWorkflowRunCount(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    connectionId: string;
    kind: ResourceRefreshKind;
    expectedCount: number;
  },
): Promise<void> {
  const result = await env.controlPlaneDb.execute(sql<{ count: string }>`
    select count(*)::text as count
    from control_plane_openworkflow.workflow_runs
    where
      workflow_name = ${SyncIntegrationConnectionResourcesWorkflowSpec.name}
      and input->>'organizationId' = ${input.organizationId}
      and input->>'connectionId' = ${input.connectionId}
      and input->>'kind' = ${input.kind}
  `);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Expected workflow run count query to return a row.");
  }

  expect(Number.parseInt(CountRowSchema.parse(row).count, 10)).toBe(input.expectedCount);
}

async function expectPersistedResourceState(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    kind: ResourceRefreshKind;
    syncState: (typeof IntegrationConnectionResourceSyncStates)[keyof typeof IntegrationConnectionResourceSyncStates];
  },
): Promise<void> {
  const persistedState =
    await env.controlPlaneDb.query.integrationConnectionResourceStates.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.connectionId, input.connectionId), eq(table.kind, input.kind)),
    });
  expect(persistedState).toBeDefined();
  if (persistedState === undefined) {
    throw new Error("Expected persisted resource state.");
  }

  expect(persistedState.syncState).toBe(input.syncState);
  expect(persistedState.lastSyncStartedAt).toBeTruthy();
  expect(persistedState.lastErrorCode).toBeNull();
  expect(persistedState.lastErrorMessage).toBeNull();
}

async function seedGithubConnection(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    organizationId: string;
    displayName: string;
  },
): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: "github_cloud",
    familyId: "github",
    variantId: "github-cloud",
    config: {
      base_url: "https://github.com",
    },
  });
  await seedConnection(env, {
    connectionId: input.connectionId,
    organizationId: input.organizationId,
    targetKey: "github_cloud",
    displayName: input.displayName,
  });
}

async function seedIntegrationTarget(
  env: IntegrationTestEnvironment,
  input: {
    targetKey: string;
    familyId: string;
    variantId: string;
    config: Record<string, string>;
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
    .onConflictDoNothing();
}

async function seedConnection(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    organizationId: string;
    targetKey: string;
    displayName: string;
    config?: Record<string, string>;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
    id: input.connectionId,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    displayName: input.displayName,
    status: IntegrationConnectionStatuses.ACTIVE,
    createdAt: "2026-03-09T00:00:00.000Z",
    updatedAt: "2026-03-09T00:00:00.000Z",
    ...(input.config === undefined ? {} : { config: input.config }),
  });
}
