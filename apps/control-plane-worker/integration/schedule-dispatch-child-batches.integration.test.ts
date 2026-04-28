import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  AutomationKinds,
  automations,
  CONTROL_PLANE_SCHEMA_NAME,
  createControlPlaneDatabase,
  organizations,
  sandboxProfiles,
  sandboxProfileVersionSnapshotJobs,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  sandboxProfileVersions,
  scheduleAutomations,
  scheduledActions,
  ScheduledActionStatuses,
  schedules,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import { ScheduleDispatchBatchWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import {
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
} from "../openworkflow/core/client.js";
import { createScheduleDispatchBatchIdempotencyKey } from "../openworkflow/schedule-dispatch/batches.js";
import { claimScheduledActionForDispatch } from "../openworkflow/schedule-dispatch/claim-scheduled-action.js";
import { dispatchScheduledAction } from "../openworkflow/schedule-dispatch/dispatch-scheduled-action.js";
import { startScheduleDispatchChildBatches } from "../openworkflow/schedule-dispatch/start-child-batches.js";
import { it } from "./test-context.js";

function createDispatchTestContext(input: { db: ReturnType<typeof createControlPlaneDatabase> }) {
  return {
    db: input.db,
    dataPlaneClient: createDataPlaneSandboxInstancesClient({
      baseUrl: "http://127.0.0.1:1",
      serviceToken: "unused-schedule-dispatch-test-token",
    }),
    defaultBaseImage: "test-default-base-image",
  };
}

async function createTestDatabase(input: { databaseUrl: string }) {
  await runControlPlaneMigrations({
    connectionString: input.databaseUrl,
    schemaName: CONTROL_PLANE_SCHEMA_NAME,
    migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
    migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
    migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
  });

  const pool = new Pool({
    connectionString: input.databaseUrl,
  });
  await pool.query(`
    delete from control_plane.scheduled_actions
    where organization_id like 'org_schedule_batch_%'
  `);
  await pool.query(`
    delete from control_plane.schedules
    where organization_id like 'org_schedule_batch_%'
  `);
  await pool.query(`
    delete from control_plane.automations
    where organization_id like 'org_schedule_batch_%'
  `);
  await pool.query(`
    delete from control_plane.organizations
    where id like 'org_schedule_batch_%'
  `);
  const db = createControlPlaneDatabase(pool);

  return {
    db,
    pool,
    stop: async () => {
      await pool.end();
    },
  };
}

async function seedAutomationSchedule(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  organizationId: string;
  automationId: string;
  scheduleId: string;
}) {
  await input.db.insert(organizations).values({
    id: input.organizationId,
    name: input.organizationId,
    slug: input.organizationId,
  });
  await input.db.insert(automations).values({
    id: input.automationId,
    organizationId: input.organizationId,
    kind: AutomationKinds.WEBHOOK,
    name: input.automationId,
    enabled: true,
  });
  await input.db.insert(schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.AUTOMATION_RUN,
    name: input.scheduleId,
    cronExpression: "0 9 * * *",
    timezone: "Asia/Singapore",
    enabled: true,
    nextScheduledAt: "2026-04-29T01:00:00.000Z",
  });
  await input.db.insert(scheduleAutomations).values({
    scheduleId: input.scheduleId,
    automationId: input.automationId,
    inputTemplate: "{}",
    conversationKeyTemplate: `conversation-${input.scheduleId}`,
    idempotencyKeyTemplate: `idempotency-${input.scheduleId}`,
  });
}

async function seedScheduledAction(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  id: string;
  organizationId: string;
  scheduleId: string;
  status?: (typeof ScheduledActionStatuses)[keyof typeof ScheduledActionStatuses];
  dispatchClaimKey?: string | null;
  dispatchingAt?: string | null;
  localScheduledTime?: string;
  scheduledAt?: string;
  targetWorkflowId?: string | null;
  targetWorkflowStartedAt?: string | null;
}) {
  await input.db.insert(scheduledActions).values({
    id: input.id,
    scheduleId: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.AUTOMATION_RUN,
    targetPayload: {
      automationId: "atm_schedule_batch_claim",
    },
    scheduledAt: input.scheduledAt ?? "2026-04-28T01:00:00.000Z",
    localScheduledDate: "2026-04-28",
    localScheduledTime: input.localScheduledTime ?? "09:00",
    status: input.status ?? ScheduledActionStatuses.PENDING,
    dispatchClaimKey: input.dispatchClaimKey,
    dispatchingAt: input.dispatchingAt,
    targetWorkflowId: input.targetWorkflowId,
    targetWorkflowStartedAt: input.targetWorkflowStartedAt,
  });
}

async function seedSnapshotRefreshScheduledAction(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  organizationId: string;
  profileId: string;
  profileVersion: number;
  scheduleId: string;
  scheduledActionId: string;
}) {
  await input.db.insert(organizations).values({
    id: input.organizationId,
    name: input.organizationId,
    slug: input.organizationId,
  });
  await input.db.insert(sandboxProfiles).values({
    id: input.profileId,
    organizationId: input.organizationId,
    displayName: input.profileId,
    status: "active",
  });
  await input.db.insert(sandboxProfileVersions).values({
    sandboxProfileId: input.profileId,
    version: input.profileVersion,
  });
  await input.db.insert(schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
    name: input.scheduleId,
    cronExpression: "0 9 * * *",
    timezone: "Asia/Singapore",
    enabled: true,
    nextScheduledAt: "2026-04-29T01:00:00.000Z",
  });
  await input.db.insert(scheduledActions).values({
    id: input.scheduledActionId,
    scheduleId: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
    targetPayload: {
      sandboxProfileId: input.profileId,
      sandboxProfileVersion: input.profileVersion,
    },
    scheduledAt: "2026-04-28T01:00:00.000Z",
    localScheduledDate: "2026-04-28",
    localScheduledTime: "09:00",
    status: ScheduledActionStatuses.PENDING,
  });
}

describe("schedule dispatch child batches", () => {
  it("atomically claims a pending scheduled action for dispatch", async ({ fixture }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedAutomationSchedule({
        db: database.db,
        organizationId: "org_schedule_batch_claim_pending",
        automationId: "atm_schedule_batch_claim",
        scheduleId: "sch_schedule_batch_claim_pending",
      });
      await seedScheduledAction({
        db: database.db,
        id: "sca_schedule_batch_claim_pending",
        organizationId: "org_schedule_batch_claim_pending",
        scheduleId: "sch_schedule_batch_claim_pending",
      });

      const claim = await claimScheduledActionForDispatch(
        { db: database.db },
        {
          scheduledActionId: "sca_schedule_batch_claim_pending",
          dispatchClaimKey: "schedule-dispatch-batch:test-claim",
          staleDispatchingBefore: new Date("2026-04-28T01:10:00.000Z"),
        },
      );

      expect(claim).toEqual(
        expect.objectContaining({
          status: "claimed",
          scheduledActionId: "sca_schedule_batch_claim_pending",
          previousStatus: ScheduledActionStatuses.PENDING,
          previousDispatchClaimKey: null,
          previousDispatchingAt: null,
        }),
      );

      const persistedAction = await database.db.query.scheduledActions.findFirst({
        where: (table, { eq }) => eq(table.id, "sca_schedule_batch_claim_pending"),
      });
      expect(persistedAction).toEqual(
        expect.objectContaining({
          status: ScheduledActionStatuses.DISPATCHING,
          dispatchClaimKey: "schedule-dispatch-batch:test-claim",
        }),
      );
      expect(persistedAction?.dispatchingAt).not.toBeNull();
    } finally {
      await database.stop();
    }
  });

  it("does not steal a non-stale dispatching action claimed by another child", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedAutomationSchedule({
        db: database.db,
        organizationId: "org_schedule_batch_active",
        automationId: "atm_schedule_batch_claim",
        scheduleId: "sch_schedule_batch_active",
      });
      await seedScheduledAction({
        db: database.db,
        id: "sca_schedule_batch_active",
        organizationId: "org_schedule_batch_active",
        scheduleId: "sch_schedule_batch_active",
        status: ScheduledActionStatuses.DISPATCHING,
        dispatchClaimKey: "schedule-dispatch-batch:first",
        dispatchingAt: "2026-04-28T01:09:00.000Z",
      });

      const claim = await claimScheduledActionForDispatch(
        { db: database.db },
        {
          scheduledActionId: "sca_schedule_batch_active",
          dispatchClaimKey: "schedule-dispatch-batch:second",
          staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
        },
      );

      expect(claim).toEqual({
        status: "actively-dispatching",
        scheduledActionId: "sca_schedule_batch_active",
      });

      const persistedAction = await database.db.query.scheduledActions.findFirst({
        where: (table, { eq }) => eq(table.id, "sca_schedule_batch_active"),
      });
      expect(persistedAction).toEqual(
        expect.objectContaining({
          status: ScheduledActionStatuses.DISPATCHING,
          dispatchClaimKey: "schedule-dispatch-batch:first",
          dispatchingAt: "2026-04-28 01:09:00+00",
        }),
      );
    } finally {
      await database.stop();
    }
  });

  it("reclaims stale dispatching actions and returns previous claim metadata", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedAutomationSchedule({
        db: database.db,
        organizationId: "org_schedule_batch_stale",
        automationId: "atm_schedule_batch_claim",
        scheduleId: "sch_schedule_batch_stale",
      });
      await seedScheduledAction({
        db: database.db,
        id: "sca_schedule_batch_stale",
        organizationId: "org_schedule_batch_stale",
        scheduleId: "sch_schedule_batch_stale",
        status: ScheduledActionStatuses.DISPATCHING,
        dispatchClaimKey: "schedule-dispatch-batch:stale",
        dispatchingAt: "2026-04-28T00:40:00.000Z",
      });

      const claim = await claimScheduledActionForDispatch(
        { db: database.db },
        {
          scheduledActionId: "sca_schedule_batch_stale",
          dispatchClaimKey: "schedule-dispatch-batch:fresh",
          staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
        },
      );

      expect(claim).toEqual(
        expect.objectContaining({
          status: "claimed",
          scheduledActionId: "sca_schedule_batch_stale",
          previousStatus: ScheduledActionStatuses.DISPATCHING,
          previousDispatchClaimKey: "schedule-dispatch-batch:stale",
          previousDispatchingAt: "2026-04-28 00:40:00+00",
        }),
      );

      const persistedAction = await database.db.query.scheduledActions.findFirst({
        where: (table, { eq }) => eq(table.id, "sca_schedule_batch_stale"),
      });
      expect(persistedAction).toEqual(
        expect.objectContaining({
          status: ScheduledActionStatuses.DISPATCHING,
          dispatchClaimKey: "schedule-dispatch-batch:fresh",
        }),
      );
    } finally {
      await database.stop();
    }
  });

  it("starts child workflows for pending and stale dispatching scheduled actions", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });
    const backend = await createControlPlaneBackend({
      url: fixture.databaseStack.directUrl,
      namespaceId: fixture.config.workflow.namespaceId,
      runMigrations: false,
    });
    const openWorkflow = createControlPlaneOpenWorkflow({
      backend,
    });

    try {
      await seedAutomationSchedule({
        db: database.db,
        organizationId: "org_schedule_batch_start",
        automationId: "atm_schedule_batch_claim",
        scheduleId: "sch_schedule_batch_start",
      });
      await seedScheduledAction({
        db: database.db,
        id: "sca_schedule_batch_recovered_pending",
        organizationId: "org_schedule_batch_start",
        scheduleId: "sch_schedule_batch_start",
      });
      await seedScheduledAction({
        db: database.db,
        id: "sca_schedule_batch_recovered_stale",
        organizationId: "org_schedule_batch_start",
        scheduleId: "sch_schedule_batch_start",
        status: ScheduledActionStatuses.DISPATCHING,
        dispatchClaimKey: "schedule-dispatch-batch:stale",
        dispatchingAt: "2026-04-28T00:40:00.000Z",
        localScheduledTime: "08:59",
        scheduledAt: "2026-04-28T00:59:00.000Z",
      });
      await seedScheduledAction({
        db: database.db,
        id: "sca_schedule_batch_active_ignored",
        organizationId: "org_schedule_batch_start",
        scheduleId: "sch_schedule_batch_start",
        status: ScheduledActionStatuses.DISPATCHING,
        dispatchClaimKey: "schedule-dispatch-batch:active",
        dispatchingAt: "2026-04-28T01:09:00.000Z",
        localScheduledTime: "08:58",
        scheduledAt: "2026-04-28T00:58:00.000Z",
      });
      await seedScheduledAction({
        db: database.db,
        id: "sca_schedule_batch_future_ignored",
        organizationId: "org_schedule_batch_start",
        scheduleId: "sch_schedule_batch_start",
        localScheduledTime: "09:01",
        scheduledAt: "2026-04-28T01:01:00.000Z",
      });

      const result = await startScheduleDispatchChildBatches(
        {
          db: database.db,
          openWorkflow,
        },
        {
          cutoffMinute: new Date("2026-04-28T01:00:00.000Z"),
          scheduledActionIds: ["sca_schedule_batch_claimed_now"],
        },
      );

      const expectedScheduledActionIds = [
        "sca_schedule_batch_claimed_now",
        "sca_schedule_batch_recovered_pending",
        "sca_schedule_batch_recovered_stale",
      ];
      expect(result).toEqual({
        scheduledActionIds: expectedScheduledActionIds,
        childBatchCount: 1,
      });

      const workflowRuns = await backend.listWorkflowRuns({
        limit: 20,
      });
      const childRun = workflowRuns.data.find(
        (workflowRun) =>
          workflowRun.workflowName === ScheduleDispatchBatchWorkflowSpec.name &&
          workflowRun.idempotencyKey ===
            createScheduleDispatchBatchIdempotencyKey(expectedScheduledActionIds),
      );

      expect(childRun).toEqual(
        expect.objectContaining({
          workflowName: ScheduleDispatchBatchWorkflowSpec.name,
          status: "pending",
          input: {
            scheduledActionIds: expectedScheduledActionIds,
          },
        }),
      );
    } finally {
      await backend.stop();
      await database.stop();
    }
  });

  it("uses OpenWorkflow idempotency when starting the same child batch twice", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });
    const backend = await createControlPlaneBackend({
      url: fixture.databaseStack.directUrl,
      namespaceId: fixture.config.workflow.namespaceId,
      runMigrations: false,
    });
    const openWorkflow = createControlPlaneOpenWorkflow({
      backend,
    });

    try {
      await seedAutomationSchedule({
        db: database.db,
        organizationId: "org_schedule_batch_idempotent",
        automationId: "atm_schedule_batch_claim",
        scheduleId: "sch_schedule_batch_idempotent",
      });
      await seedScheduledAction({
        db: database.db,
        id: "sca_schedule_batch_idempotent",
        organizationId: "org_schedule_batch_idempotent",
        scheduleId: "sch_schedule_batch_idempotent",
      });

      const input = {
        cutoffMinute: new Date("2026-04-28T01:00:00.000Z"),
        scheduledActionIds: [],
      };

      await startScheduleDispatchChildBatches(
        {
          db: database.db,
          openWorkflow,
        },
        input,
      );
      await startScheduleDispatchChildBatches(
        {
          db: database.db,
          openWorkflow,
        },
        input,
      );

      const expectedKey = createScheduleDispatchBatchIdempotencyKey([
        "sca_schedule_batch_idempotent",
      ]);
      const workflowRuns = await backend.listWorkflowRuns({
        limit: 20,
      });
      const childRuns = workflowRuns.data.filter(
        (workflowRun) =>
          workflowRun.workflowName === ScheduleDispatchBatchWorkflowSpec.name &&
          workflowRun.idempotencyKey === expectedKey,
      );

      expect(childRuns).toHaveLength(1);
    } finally {
      await backend.stop();
      await database.stop();
    }
  });

  it("marks unsupported target types as terminal scheduled action failures", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedAutomationSchedule({
        db: database.db,
        organizationId: "org_schedule_batch_unsupported",
        automationId: "atm_schedule_batch_claim",
        scheduleId: "sch_schedule_batch_unsupported",
      });
      await seedScheduledAction({
        db: database.db,
        id: "sca_schedule_batch_unsupported",
        organizationId: "org_schedule_batch_unsupported",
        scheduleId: "sch_schedule_batch_unsupported",
      });
      await database.pool.query(
        `
          update control_plane.scheduled_actions
          set target_type = 'unsupported_target'
          where id = $1
        `,
        ["sca_schedule_batch_unsupported"],
      );

      const result = await dispatchScheduledAction(createDispatchTestContext({ db: database.db }), {
        scheduledActionId: "sca_schedule_batch_unsupported",
        dispatchClaimKey: "schedule-dispatch-batch:unsupported",
        staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
      });

      expect(result).toEqual({
        scheduledActionId: "sca_schedule_batch_unsupported",
        status: "failed",
      });

      const persistedAction = await database.db.query.scheduledActions.findFirst({
        where: (table, { eq }) => eq(table.id, "sca_schedule_batch_unsupported"),
      });
      expect(persistedAction).toEqual(
        expect.objectContaining({
          status: ScheduledActionStatuses.FAILED,
          failureCode: "unsupported_target_type",
          failureMessage: "Unsupported schedule target type: unsupported_target",
        }),
      );
      expect(persistedAction?.failedAt).not.toBeNull();
    } finally {
      await database.stop();
    }
  });

  it("continues same-child retries from an in-flight scheduled action claim", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedAutomationSchedule({
        db: database.db,
        organizationId: "org_schedule_batch_same_child_retry",
        automationId: "atm_schedule_batch_claim",
        scheduleId: "sch_schedule_batch_same_child_retry",
      });
      await seedScheduledAction({
        db: database.db,
        id: "sca_schedule_batch_same_child_retry",
        organizationId: "org_schedule_batch_same_child_retry",
        scheduleId: "sch_schedule_batch_same_child_retry",
        status: ScheduledActionStatuses.DISPATCHING,
        dispatchClaimKey: "schedule-dispatch-batch:same-child",
        dispatchingAt: "2026-04-28T01:09:00.000Z",
      });
      await database.pool.query(
        `
          update control_plane.scheduled_actions
          set target_type = 'unsupported_target'
          where id = $1
        `,
        ["sca_schedule_batch_same_child_retry"],
      );

      const result = await dispatchScheduledAction(createDispatchTestContext({ db: database.db }), {
        scheduledActionId: "sca_schedule_batch_same_child_retry",
        dispatchClaimKey: "schedule-dispatch-batch:same-child",
        staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
      });

      expect(result).toEqual({
        scheduledActionId: "sca_schedule_batch_same_child_retry",
        status: "failed",
      });

      const persistedAction = await database.db.query.scheduledActions.findFirst({
        where: (table, { eq }) => eq(table.id, "sca_schedule_batch_same_child_retry"),
      });
      expect(persistedAction).toEqual(
        expect.objectContaining({
          status: ScheduledActionStatuses.FAILED,
          dispatchClaimKey: "schedule-dispatch-batch:same-child",
          failureCode: "unsupported_target_type",
          failureMessage: "Unsupported schedule target type: unsupported_target",
        }),
      );
      expect(persistedAction?.failedAt).not.toBeNull();
    } finally {
      await database.stop();
    }
  });

  it("fails the child action path without terminal failure when a known target has no handler", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedAutomationSchedule({
        db: database.db,
        organizationId: "org_schedule_batch_missing_handler",
        automationId: "atm_schedule_batch_claim",
        scheduleId: "sch_schedule_batch_missing_handler",
      });
      await seedScheduledAction({
        db: database.db,
        id: "sca_schedule_batch_missing_handler",
        organizationId: "org_schedule_batch_missing_handler",
        scheduleId: "sch_schedule_batch_missing_handler",
      });

      await expect(
        dispatchScheduledAction(createDispatchTestContext({ db: database.db }), {
          scheduledActionId: "sca_schedule_batch_missing_handler",
          dispatchClaimKey: "schedule-dispatch-batch:missing-handler",
          staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
        }),
      ).rejects.toThrow(
        `No schedule dispatch target handler is registered for ${ScheduleTargetTypes.AUTOMATION_RUN}.`,
      );

      const persistedAction = await database.db.query.scheduledActions.findFirst({
        where: (table, { eq }) => eq(table.id, "sca_schedule_batch_missing_handler"),
      });
      expect(persistedAction).toEqual(
        expect.objectContaining({
          status: ScheduledActionStatuses.DISPATCHING,
          dispatchClaimKey: "schedule-dispatch-batch:missing-handler",
          failedAt: null,
          failureCode: null,
        }),
      );
    } finally {
      await database.stop();
    }
  });

  it("reconciles already handed-off scheduled actions to dispatched", async ({ fixture }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedAutomationSchedule({
        db: database.db,
        organizationId: "org_schedule_batch_reconcile",
        automationId: "atm_schedule_batch_claim",
        scheduleId: "sch_schedule_batch_reconcile",
      });
      await seedScheduledAction({
        db: database.db,
        id: "sca_schedule_batch_reconcile",
        organizationId: "org_schedule_batch_reconcile",
        scheduleId: "sch_schedule_batch_reconcile",
        status: ScheduledActionStatuses.DISPATCHING,
        dispatchClaimKey: "schedule-dispatch-batch:reconcile",
        dispatchingAt: "2026-04-28T00:40:00.000Z",
        targetWorkflowId: "wfr_schedule_batch_reconcile",
        targetWorkflowStartedAt: "2026-04-28T00:41:00.000Z",
      });

      const result = await dispatchScheduledAction(createDispatchTestContext({ db: database.db }), {
        scheduledActionId: "sca_schedule_batch_reconcile",
        dispatchClaimKey: "schedule-dispatch-batch:fresh-reconcile",
        staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
      });

      expect(result).toEqual({
        scheduledActionId: "sca_schedule_batch_reconcile",
        status: "dispatched",
      });

      const persistedAction = await database.db.query.scheduledActions.findFirst({
        where: (table, { eq }) => eq(table.id, "sca_schedule_batch_reconcile"),
      });
      expect(persistedAction).toEqual(
        expect.objectContaining({
          status: ScheduledActionStatuses.DISPATCHED,
          targetWorkflowId: "wfr_schedule_batch_reconcile",
          targetWorkflowStartedAt: "2026-04-28 00:41:00+00",
        }),
      );
      expect(persistedAction?.dispatchedAt).not.toBeNull();
    } finally {
      await database.stop();
    }
  });

  it("marks snapshot refresh actions dispatched when the profile version already has an active snapshot job", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedSnapshotRefreshScheduledAction({
        db: database.db,
        organizationId: "org_schedule_batch_snapshot_conflict",
        profileId: "sbp_schedule_batch_snapshot_conflict",
        profileVersion: 1,
        scheduleId: "sch_schedule_batch_snapshot_conflict",
        scheduledActionId: "sca_schedule_batch_snapshot_conflict",
      });
      await database.db.insert(sandboxProfileVersionSnapshotJobs).values({
        id: "ssj_schedule_batch_snapshot_conflict",
        sandboxProfileId: "sbp_schedule_batch_snapshot_conflict",
        sandboxProfileVersion: 1,
        workflowRunId: "wfr_schedule_batch_snapshot_conflict",
        trigger: SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH,
        state: SandboxProfileVersionSnapshotJobStates.RUNNING,
      });

      const result = await dispatchScheduledAction(createDispatchTestContext({ db: database.db }), {
        scheduledActionId: "sca_schedule_batch_snapshot_conflict",
        dispatchClaimKey: "schedule-dispatch-batch:snapshot-conflict",
        staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
      });

      expect(result).toEqual({
        scheduledActionId: "sca_schedule_batch_snapshot_conflict",
        status: "dispatched",
      });

      const snapshotJobs = await database.db.query.sandboxProfileVersionSnapshotJobs.findMany({
        where: (table, { eq }) =>
          eq(table.sandboxProfileId, "sbp_schedule_batch_snapshot_conflict"),
      });
      expect(snapshotJobs).toHaveLength(1);
      const persistedAction = await database.db.query.scheduledActions.findFirst({
        where: (table, { eq }) => eq(table.id, "sca_schedule_batch_snapshot_conflict"),
      });
      expect(persistedAction).toEqual(
        expect.objectContaining({
          status: ScheduledActionStatuses.DISPATCHED,
          targetWorkflowId: "wfr_schedule_batch_snapshot_conflict",
        }),
      );
      expect(persistedAction?.dispatchedAt).not.toBeNull();
    } finally {
      await database.stop();
    }
  });

  it("creates one snapshot job per scheduled refresh action before data-plane handoff", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedSnapshotRefreshScheduledAction({
        db: database.db,
        organizationId: "org_schedule_batch_snapshot_create",
        profileId: "sbp_schedule_batch_snapshot_create",
        profileVersion: 1,
        scheduleId: "sch_schedule_batch_snapshot_create",
        scheduledActionId: "sca_schedule_batch_snapshot_create",
      });

      await expect(
        dispatchScheduledAction(createDispatchTestContext({ db: database.db }), {
          scheduledActionId: "sca_schedule_batch_snapshot_create",
          dispatchClaimKey: "schedule-dispatch-batch:snapshot-create",
          staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
        }),
      ).rejects.toThrow("fetch failed");

      await expect(
        dispatchScheduledAction(createDispatchTestContext({ db: database.db }), {
          scheduledActionId: "sca_schedule_batch_snapshot_create",
          dispatchClaimKey: "schedule-dispatch-batch:snapshot-create",
          staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
        }),
      ).rejects.toThrow("without a workflow handoff");

      const snapshotJobs = await database.db.query.sandboxProfileVersionSnapshotJobs.findMany({
        where: (table, { eq }) =>
          eq(table.sourceScheduledActionId, "sca_schedule_batch_snapshot_create"),
      });
      expect(snapshotJobs).toHaveLength(1);
      expect(snapshotJobs[0]).toEqual(
        expect.objectContaining({
          sandboxProfileId: "sbp_schedule_batch_snapshot_create",
          sandboxProfileVersion: 1,
          trigger: SandboxProfileVersionSnapshotJobTriggers.SCHEDULED_REFRESH,
          state: SandboxProfileVersionSnapshotJobStates.FAILED,
          sourceScheduledActionId: "sca_schedule_batch_snapshot_create",
          workflowRunId: null,
          errorCode: "snapshot_materialization_enqueue_failed",
        }),
      );
    } finally {
      await database.stop();
    }
  });
});
