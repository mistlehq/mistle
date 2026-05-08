/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationDeviceAuthorizationAttemptStatuses } from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import type { Clock } from "@mistle/time";
import { sql, type SQL } from "drizzle-orm";
import { BackendPostgres } from "openworkflow/postgres";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import { pruneExpiredAuthState } from "../src/maintenance/commands/prune-expired-auth-state.js";
import { pruneExpiredIntegrationAuthState } from "../src/maintenance/commands/prune-expired-integration-auth-state.js";
import { pruneStaleOpenWorkflowRuns } from "../src/maintenance/commands/prune-stale-openworkflow-runs.js";

const FixedNowMs = Date.UTC(2026, 3, 29, 0, 0, 0);
const FixedClock: Clock = {
  nowMs: () => FixedNowMs,
  nowDate: () => new Date(FixedNowMs),
};

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("maintenance commands", () => {
  it("prunes expired auth state after the retention grace", async ({ env }) => {
    const user = await seedUser(env, "auth-state");
    const oldVerificationId = "vrf_maintenance_new_old";
    const recentVerificationId = "vrf_maintenance_new_recent";
    const futureVerificationId = "vrf_maintenance_new_future";
    const oldSessionId = "ses_maintenance_new_old";
    const recentSessionId = "ses_maintenance_new_recent";
    const futureSessionId = "ses_maintenance_new_future";

    await env.controlPlaneDb.insert(env.controlPlaneTables.verifications).values([
      {
        id: oldVerificationId,
        identifier: "old@example.com",
        value: "111111",
        expiresAt: new Date(FixedNowMs - hours(25)),
      },
      {
        id: recentVerificationId,
        identifier: "recent@example.com",
        value: "222222",
        expiresAt: new Date(FixedNowMs - hours(23)),
      },
      {
        id: futureVerificationId,
        identifier: "future@example.com",
        value: "333333",
        expiresAt: new Date(FixedNowMs + hours(1)),
      },
    ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.sessions).values([
      {
        id: oldSessionId,
        userId: user.id,
        token: "maintenance-new-old-session",
        expiresAt: new Date(FixedNowMs - hours(25)),
      },
      {
        id: recentSessionId,
        userId: user.id,
        token: "maintenance-new-recent-session",
        expiresAt: new Date(FixedNowMs - hours(23)),
      },
      {
        id: futureSessionId,
        userId: user.id,
        token: "maintenance-new-future-session",
        expiresAt: new Date(FixedNowMs + hours(1)),
      },
    ]);

    await expect(
      pruneExpiredAuthState({
        db: env.controlPlaneDb,
        clock: FixedClock,
      }),
    ).resolves.toEqual({
      deletedRowCounts: {
        verifications: 1,
        sessions: 1,
      },
      reachedMaxBatches: false,
    });

    await expectExistingIds({
      env,
      table: "verifications",
      ids: [oldVerificationId, recentVerificationId, futureVerificationId],
      expectedIds: [recentVerificationId, futureVerificationId],
    });
    await expectExistingIds({
      env,
      table: "sessions",
      ids: [oldSessionId, recentSessionId, futureSessionId],
      expectedIds: [recentSessionId, futureSessionId],
    });
  });

  it("prunes expired integration auth state after command-specific retention", async ({ env }) => {
    const graph = await seedIntegrationAuthGraph(env, "integration-auth-state");
    const oldConnectionRedirectSessionId = "ios_maintenance_new_old";
    const recentConnectionRedirectSessionId = "ios_maintenance_new_recent";
    const oldIdentityLinkRedirectSessionId = "ilr_maintenance_new_old";
    const recentIdentityLinkRedirectSessionId = "ilr_maintenance_new_recent";
    const oldTerminalAttemptId = "ida_maintenance_new_terminal_old";
    const recentTerminalAttemptId = "ida_maintenance_new_terminal_recent";
    const oldPendingAttemptId = "ida_maintenance_new_pending_old";
    const recentPendingAttemptId = "ida_maintenance_new_pending_recent";
    const pendingWithoutExpiryAttemptId = "ida_maintenance_new_pending_no_expiry";

    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionRedirectSessions)
      .values([
        {
          id: oldConnectionRedirectSessionId,
          organizationId: graph.organizationId,
          targetKey: graph.targetKey,
          state: "maintenance-connection-old",
          expiresAt: iso(FixedNowMs - hours(25)),
        },
        {
          id: recentConnectionRedirectSessionId,
          organizationId: graph.organizationId,
          targetKey: graph.targetKey,
          state: "maintenance-connection-recent",
          expiresAt: iso(FixedNowMs - hours(23)),
        },
      ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.identityLinkRedirectSessions).values([
      {
        id: oldIdentityLinkRedirectSessionId,
        organizationId: graph.organizationId,
        userId: graph.userId,
        providerFamily: graph.providerFamily,
        organizationProviderConfigId: graph.providerConfigId,
        integrationConnectionId: graph.integrationConnectionId,
        state: "maintenance-identity-old",
        expiresAt: iso(FixedNowMs - hours(25)),
      },
      {
        id: recentIdentityLinkRedirectSessionId,
        organizationId: graph.organizationId,
        userId: graph.userId,
        providerFamily: graph.providerFamily,
        organizationProviderConfigId: graph.providerConfigId,
        integrationConnectionId: graph.integrationConnectionId,
        state: "maintenance-identity-recent",
        expiresAt: iso(FixedNowMs - hours(23)),
      },
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionDeviceAuthorizationAttempts)
      .values([
        {
          id: oldTerminalAttemptId,
          organizationId: graph.organizationId,
          targetKey: graph.targetKey,
          connectionMethodId: "device",
          status: IntegrationDeviceAuthorizationAttemptStatuses.COMPLETED,
          providerStateEncrypted: "provider-state",
          verificationUrl: "https://example.com/device",
          userCode: "OLDTERM",
          updatedAt: iso(FixedNowMs - days(31)),
          completedAt: iso(FixedNowMs - days(31)),
        },
        {
          id: recentTerminalAttemptId,
          organizationId: graph.organizationId,
          targetKey: graph.targetKey,
          connectionMethodId: "device",
          status: IntegrationDeviceAuthorizationAttemptStatuses.FAILED,
          providerStateEncrypted: "provider-state",
          verificationUrl: "https://example.com/device",
          userCode: "NEWTERM",
          updatedAt: iso(FixedNowMs - days(29)),
        },
        {
          id: oldPendingAttemptId,
          organizationId: graph.organizationId,
          targetKey: graph.targetKey,
          connectionMethodId: "device",
          status: IntegrationDeviceAuthorizationAttemptStatuses.PENDING,
          providerStateEncrypted: "provider-state",
          verificationUrl: "https://example.com/device",
          userCode: "OLDPEND",
          expiresAt: iso(FixedNowMs - hours(25)),
        },
        {
          id: recentPendingAttemptId,
          organizationId: graph.organizationId,
          targetKey: graph.targetKey,
          connectionMethodId: "device",
          status: IntegrationDeviceAuthorizationAttemptStatuses.PENDING,
          providerStateEncrypted: "provider-state",
          verificationUrl: "https://example.com/device",
          userCode: "NEWPEND",
          expiresAt: iso(FixedNowMs - hours(23)),
        },
        {
          id: pendingWithoutExpiryAttemptId,
          organizationId: graph.organizationId,
          targetKey: graph.targetKey,
          connectionMethodId: "device",
          status: IntegrationDeviceAuthorizationAttemptStatuses.PENDING,
          providerStateEncrypted: "provider-state",
          verificationUrl: "https://example.com/device",
          userCode: "NOEXPIR",
        },
      ]);

    await expect(
      pruneExpiredIntegrationAuthState({
        db: env.controlPlaneDb,
        clock: FixedClock,
      }),
    ).resolves.toEqual({
      deletedRowCounts: {
        integration_connection_redirect_sessions: 1,
        identity_link_redirect_sessions: 1,
        integration_connection_device_authorization_attempts_terminal: 1,
        integration_connection_device_authorization_attempts_pending_expired: 1,
      },
      reachedMaxBatches: false,
    });

    await expectExistingIds({
      env,
      table: "integrationConnectionRedirectSessions",
      ids: [oldConnectionRedirectSessionId, recentConnectionRedirectSessionId],
      expectedIds: [recentConnectionRedirectSessionId],
    });
    await expectExistingIds({
      env,
      table: "identityLinkRedirectSessions",
      ids: [oldIdentityLinkRedirectSessionId, recentIdentityLinkRedirectSessionId],
      expectedIds: [recentIdentityLinkRedirectSessionId],
    });
    await expectExistingIds({
      env,
      table: "integrationConnectionDeviceAuthorizationAttempts",
      ids: [
        oldTerminalAttemptId,
        recentTerminalAttemptId,
        oldPendingAttemptId,
        recentPendingAttemptId,
        pendingWithoutExpiryAttemptId,
      ],
      expectedIds: [recentTerminalAttemptId, recentPendingAttemptId, pendingWithoutExpiryAttemptId],
    });
  });

  it("prunes stale terminal OpenWorkflow runs in both planes", async ({ env }) => {
    const controlPlaneNamespaceId = `maintenance_control_${env.id}`;
    const dataPlaneNamespaceId = `maintenance_data_${env.id}`;
    const oldFinishedAt = new Date(FixedNowMs - days(31));
    const recentFinishedAt = new Date(FixedNowMs - days(29));
    const oldAvailableAt = new Date(FixedNowMs - days(31));
    const dataPlaneWorkflowBackend = await BackendPostgres.connect(
      env.controlPlaneDatabase.directUrl,
      {
        namespaceId: dataPlaneNamespaceId,
        runMigrations: true,
        schema: "data_plane_openworkflow",
      },
    );
    await dataPlaneWorkflowBackend.stop();

    await seedWorkflowRun({
      env,
      schemaName: "control_plane_openworkflow",
      namespaceId: controlPlaneNamespaceId,
      id: "owr_control_stale_completed",
      status: "completed",
      finishedAt: oldFinishedAt,
    });
    await seedWorkflowRun({
      env,
      schemaName: "control_plane_openworkflow",
      namespaceId: controlPlaneNamespaceId,
      id: "owr_control_recent_completed",
      status: "completed",
      finishedAt: recentFinishedAt,
    });
    await seedWorkflowRun({
      env,
      schemaName: "control_plane_openworkflow",
      namespaceId: controlPlaneNamespaceId,
      id: "owr_control_old_pending",
      status: "pending",
      availableAt: oldAvailableAt,
    });
    await seedWorkflowRun({
      env,
      schemaName: "control_plane_openworkflow",
      namespaceId: controlPlaneNamespaceId,
      id: "owr_control_running_parent",
      status: "running",
      availableAt: oldAvailableAt,
    });
    await seedWorkflowRun({
      env,
      schemaName: "control_plane_openworkflow",
      namespaceId: controlPlaneNamespaceId,
      id: "owr_control_old_child_of_running_parent",
      status: "completed",
      finishedAt: oldFinishedAt,
    });
    await seedWorkflowStepAttempt({
      env,
      schemaName: "control_plane_openworkflow",
      namespaceId: controlPlaneNamespaceId,
      id: "osa_control_stale_completed_step",
      workflowRunId: "owr_control_stale_completed",
      childWorkflowRunId: null,
    });
    await seedWorkflowStepAttempt({
      env,
      schemaName: "control_plane_openworkflow",
      namespaceId: controlPlaneNamespaceId,
      id: "osa_control_running_parent_child_step",
      workflowRunId: "owr_control_running_parent",
      childWorkflowRunId: "owr_control_old_child_of_running_parent",
    });
    await seedWorkflowSignal({
      env,
      schemaName: "control_plane_openworkflow",
      namespaceId: controlPlaneNamespaceId,
      id: "ows_control_stale_completed_signal",
      workflowRunId: "owr_control_stale_completed",
      stepAttemptId: "osa_control_stale_completed_step",
    });

    await seedWorkflowRun({
      env,
      schemaName: "data_plane_openworkflow",
      namespaceId: dataPlaneNamespaceId,
      id: "owr_data_stale_failed",
      status: "failed",
      finishedAt: oldFinishedAt,
    });
    await seedWorkflowRun({
      env,
      schemaName: "data_plane_openworkflow",
      namespaceId: dataPlaneNamespaceId,
      id: "owr_data_old_running",
      status: "running",
      availableAt: oldAvailableAt,
    });

    const controlPlanePool = new Pool({
      connectionString: env.controlPlaneDatabase.directUrl,
    });
    const dataPlanePool = new Pool({
      connectionString: env.controlPlaneDatabase.directUrl,
    });

    try {
      await expect(
        pruneStaleOpenWorkflowRuns({
          controlPlanePool,
          dataPlanePool,
          clock: FixedClock,
        }),
      ).resolves.toEqual({
        deletedRowCounts: {
          "control_plane_openworkflow.workflow_runs": 1,
          "data_plane_openworkflow.workflow_runs": 1,
        },
        reachedMaxBatches: false,
      });
    } finally {
      await Promise.all([controlPlanePool.end(), dataPlanePool.end()]);
    }

    await expectWorkflowRunIds({
      env,
      schemaName: "control_plane_openworkflow",
      namespaceId: controlPlaneNamespaceId,
      expectedIds: [
        "owr_control_old_child_of_running_parent",
        "owr_control_old_pending",
        "owr_control_recent_completed",
        "owr_control_running_parent",
      ],
    });
    await expectWorkflowRunIds({
      env,
      schemaName: "data_plane_openworkflow",
      namespaceId: dataPlaneNamespaceId,
      expectedIds: ["owr_data_old_running"],
    });
    await expectWorkflowStepAttemptIds({
      env,
      schemaName: "control_plane_openworkflow",
      namespaceId: controlPlaneNamespaceId,
      expectedIds: ["osa_control_running_parent_child_step"],
    });
    await expectWorkflowSignalIds({
      env,
      schemaName: "control_plane_openworkflow",
      namespaceId: controlPlaneNamespaceId,
      expectedIds: [],
    });
  });
});

type OpenWorkflowSchemaName = "control_plane_openworkflow" | "data_plane_openworkflow";

async function seedWorkflowRun(input: {
  env: IntegrationTestEnvironment;
  schemaName: OpenWorkflowSchemaName;
  namespaceId: string;
  id: string;
  status: string;
  finishedAt?: Date;
  availableAt?: Date;
}): Promise<void> {
  const workflowRunsTable = workflowTable(input.schemaName, "workflow_runs");
  const statement = sql`
    insert into ${workflowRunsTable} (
      namespace_id,
      id,
      workflow_name,
      version,
      status,
      idempotency_key,
      config,
      context,
      input,
      attempts,
      available_at,
      deadline_at,
      started_at,
      finished_at,
      created_at,
      updated_at
    )
    values (
      ${input.namespaceId},
      ${input.id},
      ${`maintenance.${input.id}`},
      ${"1"},
      ${input.status},
      ${null},
      ${JSON.stringify({})}::jsonb,
      ${null},
      ${JSON.stringify({ id: input.id })}::jsonb,
      ${0},
      ${input.availableAt ?? null},
      ${null},
      ${null},
      ${input.finishedAt ?? null},
      ${new Date(FixedNowMs - days(31))},
      ${new Date(FixedNowMs - days(31))}
    )
  `;

  await executeWorkflowStatement({
    env: input.env,
    statement,
  });
}

async function seedWorkflowStepAttempt(input: {
  env: IntegrationTestEnvironment;
  schemaName: OpenWorkflowSchemaName;
  namespaceId: string;
  id: string;
  workflowRunId: string;
  childWorkflowRunId: string | null;
}): Promise<void> {
  const stepAttemptsTable = workflowTable(input.schemaName, "step_attempts");
  const statement = sql`
    insert into ${stepAttemptsTable} (
      namespace_id,
      id,
      workflow_run_id,
      step_name,
      kind,
      status,
      config,
      context,
      output,
      error,
      child_workflow_run_namespace_id,
      child_workflow_run_id,
      started_at,
      finished_at,
      created_at,
      updated_at
    )
    values (
      ${input.namespaceId},
      ${input.id},
      ${input.workflowRunId},
      ${`maintenance.${input.id}`},
      ${"workflow"},
      ${"running"},
      ${JSON.stringify({})}::jsonb,
      ${null},
      ${null},
      ${null},
      ${input.childWorkflowRunId === null ? null : input.namespaceId},
      ${input.childWorkflowRunId},
      ${new Date(FixedNowMs - days(31))},
      ${null},
      ${new Date(FixedNowMs - days(31))},
      ${new Date(FixedNowMs - days(31))}
    )
  `;

  await executeWorkflowStatement({
    env: input.env,
    statement,
  });
}

async function seedWorkflowSignal(input: {
  env: IntegrationTestEnvironment;
  schemaName: OpenWorkflowSchemaName;
  namespaceId: string;
  id: string;
  workflowRunId: string;
  stepAttemptId: string;
}): Promise<void> {
  const workflowSignalsTable = workflowTable(input.schemaName, "workflow_signals");
  const statement = sql`
    insert into ${workflowSignalsTable} (
      namespace_id,
      id,
      signal,
      data,
      sender_idempotency_key,
      workflow_run_id,
      step_attempt_id,
      created_at
    )
    values (
      ${input.namespaceId},
      ${input.id},
      ${"maintenance.signal"},
      ${JSON.stringify({ id: input.id })}::jsonb,
      ${null},
      ${input.workflowRunId},
      ${input.stepAttemptId},
      ${new Date(FixedNowMs - days(31))}
    )
  `;

  await executeWorkflowStatement({
    env: input.env,
    statement,
  });
}

async function expectWorkflowRunIds(input: {
  env: IntegrationTestEnvironment;
  schemaName: OpenWorkflowSchemaName;
  namespaceId: string;
  expectedIds: string[];
}): Promise<void> {
  const rows = await selectWorkflowIds({
    env: input.env,
    schemaName: input.schemaName,
    tableName: "workflow_runs",
    namespaceId: input.namespaceId,
  });
  expect(rows.map((row) => row.id).sort()).toEqual(input.expectedIds.toSorted());
}

async function expectWorkflowStepAttemptIds(input: {
  env: IntegrationTestEnvironment;
  schemaName: OpenWorkflowSchemaName;
  namespaceId: string;
  expectedIds: string[];
}): Promise<void> {
  const rows = await selectWorkflowIds({
    env: input.env,
    schemaName: input.schemaName,
    tableName: "step_attempts",
    namespaceId: input.namespaceId,
  });
  expect(rows.map((row) => row.id).sort()).toEqual(input.expectedIds.toSorted());
}

async function expectWorkflowSignalIds(input: {
  env: IntegrationTestEnvironment;
  schemaName: OpenWorkflowSchemaName;
  namespaceId: string;
  expectedIds: string[];
}): Promise<void> {
  const rows = await selectWorkflowIds({
    env: input.env,
    schemaName: input.schemaName,
    tableName: "workflow_signals",
    namespaceId: input.namespaceId,
  });
  expect(rows.map((row) => row.id).sort()).toEqual(input.expectedIds.toSorted());
}

async function selectWorkflowIds(input: {
  env: IntegrationTestEnvironment;
  schemaName: OpenWorkflowSchemaName;
  tableName: "step_attempts" | "workflow_runs" | "workflow_signals";
  namespaceId: string;
}): Promise<Array<{ id: string }>> {
  const table = workflowTable(input.schemaName, input.tableName);
  const statement = sql<{ id: string }>`
    select id
    from ${table}
    where namespace_id = ${input.namespaceId}
  `;
  const result = await input.env.controlPlaneDb.execute(statement);
  return parseWorkflowIdRows(result.rows);
}

function parseWorkflowIdRows(rows: ReadonlyArray<Record<string, unknown>>): Array<{ id: string }> {
  return rows.map((row) => {
    if (typeof row.id !== "string") {
      throw new Error("Expected OpenWorkflow id query to return string ids.");
    }

    return {
      id: row.id,
    };
  });
}

async function executeWorkflowStatement(input: {
  env: IntegrationTestEnvironment;
  statement: SQL;
}): Promise<void> {
  await input.env.controlPlaneDb.execute(input.statement);
}

function workflowTable(
  schemaName: OpenWorkflowSchemaName,
  tableName: "step_attempts" | "workflow_runs" | "workflow_signals",
): SQL {
  return sql.raw(`${schemaName}.${tableName}`);
}

async function seedUser(env: IntegrationTestEnvironment, label: string): Promise<{ id: string }> {
  const id = `usr_maintenance_new_${label.replaceAll("-", "_")}`;
  await env.controlPlaneDb.insert(env.controlPlaneTables.users).values({
    id,
    name: `Maintenance ${label}`,
    email: `${label}@maintenance-new.example.com`,
  });

  return { id };
}

async function seedIntegrationAuthGraph(
  env: IntegrationTestEnvironment,
  label: string,
): Promise<{
  organizationId: string;
  userId: string;
  targetKey: string;
  providerFamily: string;
  integrationConnectionId: string;
  providerConfigId: string;
}> {
  const normalizedLabel = label.replaceAll("-", "_");
  const organizationId = `org_maintenance_new_${normalizedLabel}`;
  const userId = `usr_maintenance_new_${normalizedLabel}`;
  const targetKey = `maintenance-new-${label}`;
  const providerFamily = `maintenance-new-${label}`;
  const integrationConnectionId = `icn_maintenance_new_${normalizedLabel}`;
  const providerConfigId = `ilp_maintenance_new_${normalizedLabel}`;

  await env.controlPlaneDb.insert(env.controlPlaneTables.organizations).values({
    id: organizationId,
    name: `Maintenance ${label}`,
    slug: `maintenance-new-${label}`,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.users).values({
    id: userId,
    name: `Maintenance ${label}`,
    email: `${label}@maintenance-new.example.com`,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values({
    targetKey,
    familyId: providerFamily,
    variantId: "default",
    enabled: true,
    config: {},
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
    id: integrationConnectionId,
    organizationId,
    targetKey,
    displayName: `Maintenance ${label}`,
  });
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.organizationIdentityLinkProviderConfigs)
    .values({
      id: providerConfigId,
      organizationId,
      providerFamily,
      integrationTargetKey: targetKey,
      integrationConnectionId,
      createdByUserId: userId,
      updatedByUserId: userId,
    });

  return {
    organizationId,
    userId,
    targetKey,
    providerFamily,
    integrationConnectionId,
    providerConfigId,
  };
}

async function expectExistingIds(input: {
  env: IntegrationTestEnvironment;
  table:
    | "identityLinkRedirectSessions"
    | "integrationConnectionDeviceAuthorizationAttempts"
    | "integrationConnectionRedirectSessions"
    | "sessions"
    | "verifications";
  ids: string[];
  expectedIds: string[];
}): Promise<void> {
  const rows = await selectExistingIds(input);
  expect(rows.map((row) => row.id).sort()).toEqual(input.expectedIds.toSorted());
}

async function selectExistingIds(input: {
  env: IntegrationTestEnvironment;
  table:
    | "identityLinkRedirectSessions"
    | "integrationConnectionDeviceAuthorizationAttempts"
    | "integrationConnectionRedirectSessions"
    | "sessions"
    | "verifications";
  ids: string[];
}): Promise<Array<{ id: string }>> {
  if (input.table === "verifications") {
    return input.env.controlPlaneDb.query.verifications.findMany({
      columns: { id: true },
      where: (table, { inArray }) => inArray(table.id, input.ids),
    });
  }
  if (input.table === "sessions") {
    return input.env.controlPlaneDb.query.sessions.findMany({
      columns: { id: true },
      where: (table, { inArray }) => inArray(table.id, input.ids),
    });
  }
  if (input.table === "integrationConnectionRedirectSessions") {
    return input.env.controlPlaneDb.query.integrationConnectionRedirectSessions.findMany({
      columns: { id: true },
      where: (table, { inArray }) => inArray(table.id, input.ids),
    });
  }
  if (input.table === "identityLinkRedirectSessions") {
    return input.env.controlPlaneDb.query.identityLinkRedirectSessions.findMany({
      columns: { id: true },
      where: (table, { inArray }) => inArray(table.id, input.ids),
    });
  }

  return input.env.controlPlaneDb.query.integrationConnectionDeviceAuthorizationAttempts.findMany({
    columns: { id: true },
    where: (table, { inArray }) => inArray(table.id, input.ids),
  });
}

function hours(value: number): number {
  return value * 60 * 60 * 1_000;
}

function days(value: number): number {
  return value * 24 * 60 * 60 * 1_000;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
