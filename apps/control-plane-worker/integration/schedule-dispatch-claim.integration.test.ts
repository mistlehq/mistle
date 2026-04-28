import {
  AutomationKinds,
  automations,
  CONTROL_PLANE_SCHEMA_NAME,
  createControlPlaneDatabase,
  organizations,
  sandboxProfiles,
  sandboxProfileSnapshotRefreshScheduleTargets,
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
import { asc } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import { dispatchDueSchedules } from "../openworkflow/schedule-dispatch/dispatch-due-schedules.js";
import { it } from "./test-context.js";

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
    where organization_id like 'org_schedule_dispatch_%'
  `);
  await pool.query(`
    delete from control_plane.schedules
    where organization_id like 'org_schedule_dispatch_%'
  `);
  await pool.query(`
    delete from control_plane.automations
    where organization_id like 'org_schedule_dispatch_%'
  `);
  await pool.query(`
    delete from control_plane.organizations
    where id like 'org_schedule_dispatch_%'
  `);
  const db = createControlPlaneDatabase(pool);

  return {
    db,
    stop: async () => {
      await pool.end();
    },
  };
}

async function seedOrganizationAndAutomation(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  organizationId: string;
  automationId: string;
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
}

async function seedAutomationSchedule(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  scheduleId: string;
  organizationId: string;
  automationId: string;
  name?: string;
  cronExpression?: string;
  timezone?: string;
  enabled?: boolean;
  nextScheduledAt?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  deletedAt?: string | null;
}) {
  await input.db.insert(schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.AUTOMATION_RUN,
    name: input.name ?? input.scheduleId,
    cronExpression: input.cronExpression ?? "0 9 * * *",
    timezone: input.timezone ?? "Asia/Singapore",
    enabled: input.enabled ?? true,
    nextScheduledAt: input.nextScheduledAt,
    startAt: input.startAt,
    endAt: input.endAt,
    deletedAt: input.deletedAt,
  });
  await input.db.insert(scheduleAutomations).values({
    scheduleId: input.scheduleId,
    automationId: input.automationId,
    inputTemplate: "{}",
    conversationKeyTemplate: `conversation-${input.scheduleId}`,
    idempotencyKeyTemplate: `idempotency-${input.scheduleId}`,
  });
}

async function listSchedules(input: { db: ReturnType<typeof createControlPlaneDatabase> }) {
  return input.db.query.schedules.findMany({
    orderBy: (table) => [asc(table.id)],
  });
}

async function listScheduledActions(input: { db: ReturnType<typeof createControlPlaneDatabase> }) {
  return input.db.query.scheduledActions.findMany({
    orderBy: (table) => [asc(table.scheduledAt), asc(table.id)],
  });
}

describe("schedule dispatch claim", () => {
  it("claims due automation schedules and advances their cursors", async ({ fixture }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedOrganizationAndAutomation({
        db: database.db,
        organizationId: "org_schedule_dispatch_claim",
        automationId: "atm_schedule_dispatch_claim",
      });
      await seedAutomationSchedule({
        db: database.db,
        scheduleId: "sch_schedule_dispatch_due",
        organizationId: "org_schedule_dispatch_claim",
        automationId: "atm_schedule_dispatch_claim",
        nextScheduledAt: "2026-04-28T01:00:00.000Z",
      });
      await seedAutomationSchedule({
        db: database.db,
        scheduleId: "sch_schedule_dispatch_future",
        organizationId: "org_schedule_dispatch_claim",
        automationId: "atm_schedule_dispatch_claim",
        nextScheduledAt: "2026-04-29T01:00:00.000Z",
      });
      await seedAutomationSchedule({
        db: database.db,
        scheduleId: "sch_schedule_dispatch_disabled",
        organizationId: "org_schedule_dispatch_claim",
        automationId: "atm_schedule_dispatch_claim",
        enabled: false,
        nextScheduledAt: "2026-04-28T01:00:00.000Z",
      });
      await seedAutomationSchedule({
        db: database.db,
        scheduleId: "sch_schedule_dispatch_deleted",
        organizationId: "org_schedule_dispatch_claim",
        automationId: "atm_schedule_dispatch_claim",
        deletedAt: "2026-04-27T00:00:00.000Z",
        nextScheduledAt: "2026-04-28T01:00:00.000Z",
      });
      await seedAutomationSchedule({
        db: database.db,
        scheduleId: "sch_schedule_dispatch_no_next",
        organizationId: "org_schedule_dispatch_claim",
        automationId: "atm_schedule_dispatch_claim",
        nextScheduledAt: null,
      });

      const result = await dispatchDueSchedules(
        { db: database.db },
        {
          cutoffMinute: new Date("2026-04-28T01:00:00.000Z"),
        },
      );

      expect(result.pendingScheduledActionIds).toHaveLength(1);
      expect(result.claimedScheduleCount).toBe(1);
      expect(result.createdScheduledActionCount).toBe(1);
      expect(result.failedScheduledActionCount).toBe(0);
      expect(result.skippedLateCount).toBe(0);
      expect(result.reachedMaxBatches).toBe(false);

      const persistedActions = await listScheduledActions({ db: database.db });
      expect(persistedActions).toEqual([
        expect.objectContaining({
          scheduleId: "sch_schedule_dispatch_due",
          organizationId: "org_schedule_dispatch_claim",
          targetType: ScheduleTargetTypes.AUTOMATION_RUN,
          targetPayload: {
            automationId: "atm_schedule_dispatch_claim",
          },
          scheduledAt: "2026-04-28 01:00:00+00",
          localScheduledDate: "2026-04-28",
          localScheduledTime: "09:00",
          status: ScheduledActionStatuses.PENDING,
        }),
      ]);

      const persistedSchedules = await listSchedules({ db: database.db });
      expect(persistedSchedules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "sch_schedule_dispatch_due",
            lastScheduledAt: "2026-04-28 01:00:00+00",
            nextScheduledAt: "2026-04-29 01:00:00+00",
            enabled: true,
          }),
          expect.objectContaining({
            id: "sch_schedule_dispatch_future",
            nextScheduledAt: "2026-04-29 01:00:00+00",
          }),
          expect.objectContaining({
            id: "sch_schedule_dispatch_disabled",
            nextScheduledAt: "2026-04-28 01:00:00+00",
          }),
          expect.objectContaining({
            id: "sch_schedule_dispatch_deleted",
            nextScheduledAt: "2026-04-28 01:00:00+00",
          }),
          expect.objectContaining({
            id: "sch_schedule_dispatch_no_next",
            nextScheduledAt: null,
          }),
        ]),
      );
    } finally {
      await database.stop();
    }
  });

  it("does not duplicate scheduled actions when dispatch is retried for the same cutoff", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedOrganizationAndAutomation({
        db: database.db,
        organizationId: "org_schedule_dispatch_retry",
        automationId: "atm_schedule_dispatch_retry",
      });
      await seedAutomationSchedule({
        db: database.db,
        scheduleId: "sch_schedule_dispatch_retry",
        organizationId: "org_schedule_dispatch_retry",
        automationId: "atm_schedule_dispatch_retry",
        nextScheduledAt: "2026-04-28T01:00:00.000Z",
      });

      await dispatchDueSchedules(
        { db: database.db },
        {
          cutoffMinute: new Date("2026-04-28T01:00:00.000Z"),
        },
      );
      await dispatchDueSchedules(
        { db: database.db },
        {
          cutoffMinute: new Date("2026-04-28T01:00:00.000Z"),
        },
      );

      const persistedActions = await listScheduledActions({ db: database.db });
      expect(persistedActions).toHaveLength(1);
      expect(persistedActions[0]).toEqual(
        expect.objectContaining({
          scheduleId: "sch_schedule_dispatch_retry",
          scheduledAt: "2026-04-28 01:00:00+00",
        }),
      );
    } finally {
      await database.stop();
    }
  });

  it("disables finite schedules when there is no future occurrence within end_at", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedOrganizationAndAutomation({
        db: database.db,
        organizationId: "org_schedule_dispatch_finite",
        automationId: "atm_schedule_dispatch_finite",
      });
      await seedAutomationSchedule({
        db: database.db,
        scheduleId: "sch_schedule_dispatch_finite",
        organizationId: "org_schedule_dispatch_finite",
        automationId: "atm_schedule_dispatch_finite",
        endAt: "2026-04-28T01:00:00.000Z",
        nextScheduledAt: "2026-04-28T01:00:00.000Z",
      });

      await dispatchDueSchedules(
        { db: database.db },
        {
          cutoffMinute: new Date("2026-04-28T01:00:00.000Z"),
        },
      );

      const persistedSchedule = await database.db.query.schedules.findFirst({
        where: (table, { eq }) => eq(table.id, "sch_schedule_dispatch_finite"),
      });
      expect(persistedSchedule).toEqual(
        expect.objectContaining({
          enabled: false,
          lastScheduledAt: "2026-04-28 01:00:00+00",
          nextScheduledAt: null,
        }),
      );
    } finally {
      await database.stop();
    }
  });

  it("snapshots sandbox profile refresh target payloads", async ({ fixture }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await database.db.insert(organizations).values({
        id: "org_schedule_dispatch_snapshot",
        name: "org_schedule_dispatch_snapshot",
        slug: "org_schedule_dispatch_snapshot",
      });
      await database.db.insert(sandboxProfiles).values({
        id: "sbp_schedule_dispatch_snapshot",
        organizationId: "org_schedule_dispatch_snapshot",
        displayName: "Snapshot schedule profile",
        status: "active",
      });
      await database.db.insert(sandboxProfileVersions).values({
        sandboxProfileId: "sbp_schedule_dispatch_snapshot",
        version: 3,
      });
      await database.db.insert(schedules).values({
        id: "sch_schedule_dispatch_snapshot",
        organizationId: "org_schedule_dispatch_snapshot",
        targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
        name: "Snapshot refresh",
        cronExpression: "0 9 * * *",
        timezone: "Asia/Singapore",
        enabled: true,
        nextScheduledAt: "2026-04-28T01:00:00.000Z",
      });
      await database.db.insert(sandboxProfileSnapshotRefreshScheduleTargets).values({
        scheduleId: "sch_schedule_dispatch_snapshot",
        sandboxProfileId: "sbp_schedule_dispatch_snapshot",
        sandboxProfileVersion: 3,
      });

      const result = await dispatchDueSchedules(
        { db: database.db },
        {
          cutoffMinute: new Date("2026-04-28T01:00:00.000Z"),
        },
      );

      expect(result.pendingScheduledActionIds).toHaveLength(1);
      expect(result.createdScheduledActionCount).toBe(1);
      const persistedActions = await listScheduledActions({ db: database.db });
      expect(persistedActions).toEqual([
        expect.objectContaining({
          scheduleId: "sch_schedule_dispatch_snapshot",
          targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
          targetPayload: {
            sandboxProfileId: "sbp_schedule_dispatch_snapshot",
            sandboxProfileVersion: 3,
          },
          status: ScheduledActionStatuses.PENDING,
        }),
      ]);
    } finally {
      await database.stop();
    }
  });

  it("compacts old backlog into skipped_late and then claims due in-window slots", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedOrganizationAndAutomation({
        db: database.db,
        organizationId: "org_schedule_dispatch_backlog",
        automationId: "atm_schedule_dispatch_backlog",
      });
      await seedAutomationSchedule({
        db: database.db,
        scheduleId: "sch_schedule_dispatch_backlog",
        organizationId: "org_schedule_dispatch_backlog",
        automationId: "atm_schedule_dispatch_backlog",
        nextScheduledAt: "2026-04-25T01:00:00.000Z",
      });

      const result = await dispatchDueSchedules(
        { db: database.db },
        {
          cutoffMinute: new Date("2026-04-28T01:00:00.000Z"),
        },
      );

      expect(result.pendingScheduledActionIds).toHaveLength(2);
      expect(result.backlogFastForwardedCount).toBe(1);
      expect(result.createdScheduledActionCount).toBe(3);
      expect(result.skippedLateCount).toBe(1);
      const persistedActions = await listScheduledActions({ db: database.db });
      expect(persistedActions).toEqual([
        expect.objectContaining({
          scheduleId: "sch_schedule_dispatch_backlog",
          scheduledAt: "2026-04-25 01:00:00+00",
          status: ScheduledActionStatuses.SKIPPED_LATE,
          skippedFromScheduledAt: "2026-04-25 01:00:00+00",
          skippedUntilScheduledAt: "2026-04-26 01:00:00+00",
          failureCode: "catch_up_window_exceeded",
        }),
        expect.objectContaining({
          scheduleId: "sch_schedule_dispatch_backlog",
          scheduledAt: "2026-04-27 01:00:00+00",
          status: ScheduledActionStatuses.PENDING,
        }),
        expect.objectContaining({
          scheduleId: "sch_schedule_dispatch_backlog",
          scheduledAt: "2026-04-28 01:00:00+00",
          status: ScheduledActionStatuses.PENDING,
        }),
      ]);

      const persistedSchedule = await database.db.query.schedules.findFirst({
        where: (table, { eq }) => eq(table.id, "sch_schedule_dispatch_backlog"),
      });
      expect(persistedSchedule).toEqual(
        expect.objectContaining({
          lastScheduledAt: "2026-04-28 01:00:00+00",
          nextScheduledAt: "2026-04-29 01:00:00+00",
          enabled: true,
        }),
      );
    } finally {
      await database.stop();
    }
  });

  it("consumes repeated fall-back local slots without creating a second action", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedOrganizationAndAutomation({
        db: database.db,
        organizationId: "org_schedule_dispatch_fallback",
        automationId: "atm_schedule_dispatch_fallback",
      });
      await seedAutomationSchedule({
        db: database.db,
        scheduleId: "sch_schedule_dispatch_fallback",
        organizationId: "org_schedule_dispatch_fallback",
        automationId: "atm_schedule_dispatch_fallback",
        cronExpression: "30 1 * * *",
        timezone: "America/New_York",
        nextScheduledAt: "2026-11-01T06:30:00.000Z",
      });
      await database.db.insert(scheduledActions).values({
        scheduleId: "sch_schedule_dispatch_fallback",
        organizationId: "org_schedule_dispatch_fallback",
        targetType: ScheduleTargetTypes.AUTOMATION_RUN,
        targetPayload: {
          automationId: "atm_schedule_dispatch_fallback",
        },
        scheduledAt: "2026-11-01T05:30:00.000Z",
        localScheduledDate: "2026-11-01",
        localScheduledTime: "01:30",
      });

      const result = await dispatchDueSchedules(
        { db: database.db },
        {
          cutoffMinute: new Date("2026-11-01T06:30:00.000Z"),
        },
      );

      expect(result.pendingScheduledActionIds).toHaveLength(0);
      expect(result.duplicateScheduledActionCount).toBe(1);
      expect(result.skippedLateCount).toBe(0);
      const persistedActions = await listScheduledActions({ db: database.db });
      expect(persistedActions).toHaveLength(1);
      expect(persistedActions[0]).toEqual(
        expect.objectContaining({
          scheduledAt: "2026-11-01 05:30:00+00",
          localScheduledDate: "2026-11-01",
          localScheduledTime: "01:30",
        }),
      );

      const persistedSchedule = await database.db.query.schedules.findFirst({
        where: (table, { eq }) => eq(table.id, "sch_schedule_dispatch_fallback"),
      });
      expect(persistedSchedule).toEqual(
        expect.objectContaining({
          lastScheduledAt: "2026-11-01 06:30:00+00",
          nextScheduledAt: "2026-11-02 06:30:00+00",
        }),
      );
    } finally {
      await database.stop();
    }
  });

  it("fails the action and soft-deletes the schedule when the target row is missing", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await seedOrganizationAndAutomation({
        db: database.db,
        organizationId: "org_schedule_dispatch_missing_target",
        automationId: "atm_schedule_dispatch_missing_target",
      });
      await database.db.insert(schedules).values({
        id: "sch_schedule_dispatch_missing_target",
        organizationId: "org_schedule_dispatch_missing_target",
        targetType: ScheduleTargetTypes.AUTOMATION_RUN,
        name: "Missing target",
        cronExpression: "0 9 * * *",
        timezone: "Asia/Singapore",
        enabled: true,
        nextScheduledAt: "2026-04-28T01:00:00.000Z",
      });

      const result = await dispatchDueSchedules(
        { db: database.db },
        {
          cutoffMinute: new Date("2026-04-28T01:00:00.000Z"),
        },
      );

      expect(result.pendingScheduledActionIds).toHaveLength(0);
      expect(result.createdScheduledActionCount).toBe(1);
      expect(result.failedScheduledActionCount).toBe(1);
      const persistedActions = await listScheduledActions({ db: database.db });
      expect(persistedActions).toEqual([
        expect.objectContaining({
          scheduleId: "sch_schedule_dispatch_missing_target",
          status: ScheduledActionStatuses.FAILED,
          failureCode: "target_missing",
          targetPayload: {
            scheduleId: "sch_schedule_dispatch_missing_target",
            targetType: ScheduleTargetTypes.AUTOMATION_RUN,
          },
        }),
      ]);

      const persistedSchedule = await database.db.query.schedules.findFirst({
        where: (table, { eq }) => eq(table.id, "sch_schedule_dispatch_missing_target"),
      });
      expect(persistedSchedule).toEqual(
        expect.objectContaining({
          enabled: false,
          nextScheduledAt: null,
        }),
      );
      expect(persistedSchedule?.deletedAt).not.toBeNull();
    } finally {
      await database.stop();
    }
  });
});
