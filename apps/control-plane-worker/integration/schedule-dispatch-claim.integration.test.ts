/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  TriggerKinds,
  ScheduledActionStatuses,
  ScheduleKinds,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { dispatchDueSchedules } from "../openworkflow/schedule-dispatch/dispatch-due-schedules.js";

const it = createIntegrationTest({
  services: ["control-plane-worker"],
});

describe("control-plane worker schedule dispatch claims", () => {
  it("claims due trigger schedules and advances their cursors", async ({ env }) => {
    await seedOrganizationAndTrigger({
      env,
      organizationId: "org_integration_new_schedule_claim",
      triggerId: "atm_integration_new_schedule_claim_due",
    });
    await seedTrigger({
      env,
      organizationId: "org_integration_new_schedule_claim",
      triggerId: "atm_integration_new_schedule_claim_future",
    });
    await seedTrigger({
      env,
      organizationId: "org_integration_new_schedule_claim",
      triggerId: "atm_integration_new_schedule_claim_disabled",
    });
    await seedTrigger({
      env,
      organizationId: "org_integration_new_schedule_claim",
      triggerId: "atm_integration_new_schedule_claim_deleted",
    });
    await seedTrigger({
      env,
      organizationId: "org_integration_new_schedule_claim",
      triggerId: "atm_integration_new_schedule_claim_no_next",
    });
    await seedTriggerSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_due",
      organizationId: "org_integration_new_schedule_claim",
      triggerId: "atm_integration_new_schedule_claim_due",
      nextScheduledAt: "2026-04-28T01:00:00.000Z",
    });
    await seedTriggerSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_future",
      organizationId: "org_integration_new_schedule_claim",
      triggerId: "atm_integration_new_schedule_claim_future",
      nextScheduledAt: "2026-04-29T01:00:00.000Z",
    });
    await seedTriggerSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_disabled",
      organizationId: "org_integration_new_schedule_claim",
      triggerId: "atm_integration_new_schedule_claim_disabled",
      enabled: false,
      nextScheduledAt: "2026-04-28T01:00:00.000Z",
    });
    await seedTriggerSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_deleted",
      organizationId: "org_integration_new_schedule_claim",
      triggerId: "atm_integration_new_schedule_claim_deleted",
      deletedAt: "2026-04-27T00:00:00.000Z",
      nextScheduledAt: "2026-04-28T01:00:00.000Z",
    });
    await seedTriggerSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_no_next",
      organizationId: "org_integration_new_schedule_claim",
      triggerId: "atm_integration_new_schedule_claim_no_next",
      nextScheduledAt: null,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.schedules).values({
      id: "sch_integration_new_schedule_one_off",
      organizationId: "org_integration_new_schedule_claim",
      targetType: ScheduleTargetTypes.TRIGGER_RUN,
      kind: ScheduleKinds.ONE_OFF,
      name: "One-off schedule",
      enabled: true,
      nextScheduledAt: "2026-04-28T01:00:00.000Z",
      oneOffWorkflowRunId: "owr_integration_new_schedule_one_off",
    });

    const result = await dispatchDueSchedules(
      { db: env.controlPlaneDb },
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

    const persistedActions = await env.controlPlaneDb.query.scheduledActions.findMany({
      orderBy: (table, { asc }) => [asc(table.scheduledAt), asc(table.id)],
    });
    expect(persistedActions).toEqual([
      expect.objectContaining({
        scheduleId: "sch_integration_new_schedule_due",
        organizationId: "org_integration_new_schedule_claim",
        targetType: ScheduleTargetTypes.TRIGGER_RUN,
        targetPayload: {
          triggerId: "atm_integration_new_schedule_claim_due",
        },
        scheduledAt: "2026-04-28 01:00:00+00",
        localScheduledDate: "2026-04-28",
        localScheduledTime: "09:00",
        status: ScheduledActionStatuses.PENDING,
      }),
    ]);

    const persistedSchedules = await env.controlPlaneDb.query.schedules.findMany({
      orderBy: (table, { asc }) => [asc(table.id)],
    });
    expect(persistedSchedules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "sch_integration_new_schedule_due",
          lastScheduledAt: "2026-04-28 01:00:00+00",
          nextScheduledAt: "2026-04-29 01:00:00+00",
          enabled: true,
        }),
        expect.objectContaining({
          id: "sch_integration_new_schedule_future",
          nextScheduledAt: "2026-04-29 01:00:00+00",
        }),
        expect.objectContaining({
          id: "sch_integration_new_schedule_disabled",
          nextScheduledAt: "2026-04-28 01:00:00+00",
        }),
        expect.objectContaining({
          id: "sch_integration_new_schedule_deleted",
          nextScheduledAt: "2026-04-28 01:00:00+00",
        }),
        expect.objectContaining({
          id: "sch_integration_new_schedule_no_next",
          nextScheduledAt: null,
        }),
        expect.objectContaining({
          id: "sch_integration_new_schedule_one_off",
          nextScheduledAt: "2026-04-28 01:00:00+00",
          lastScheduledAt: null,
          enabled: true,
        }),
      ]),
    );
  });

  it("does not duplicate scheduled actions when dispatch is retried", async ({ env }) => {
    await seedOrganizationAndTrigger({
      env,
      organizationId: "org_integration_new_schedule_retry",
      triggerId: "atm_integration_new_schedule_retry",
    });
    await seedTriggerSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_retry",
      organizationId: "org_integration_new_schedule_retry",
      triggerId: "atm_integration_new_schedule_retry",
      nextScheduledAt: "2026-04-28T01:00:00.000Z",
    });

    const firstResult = await dispatchDueSchedules(
      { db: env.controlPlaneDb },
      {
        cutoffMinute: new Date("2026-04-28T01:00:00.000Z"),
      },
    );
    const retryResult = await dispatchDueSchedules(
      { db: env.controlPlaneDb },
      {
        cutoffMinute: new Date("2026-04-28T01:00:00.000Z"),
      },
    );

    expect(firstResult.createdScheduledActionCount).toBe(1);
    expect(retryResult.createdScheduledActionCount).toBe(0);

    const persistedActions = await env.controlPlaneDb.query.scheduledActions.findMany({
      where: (table, { eq }) => eq(table.scheduleId, "sch_integration_new_schedule_retry"),
    });
    expect(persistedActions).toHaveLength(1);
  });

  it("collapses stale interval schedule catch-up to the latest due occurrence", async ({ env }) => {
    await seedOrganizationAndTrigger({
      env,
      organizationId: "org_integration_new_schedule_interval_collapse",
      triggerId: "atm_integration_new_schedule_interval_collapse",
    });
    await seedTriggerSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_interval_collapse",
      organizationId: "org_integration_new_schedule_interval_collapse",
      triggerId: "atm_integration_new_schedule_interval_collapse",
      cronExpression: "*/10 * * * *",
      nextScheduledAt: "2026-04-28T01:00:00.000Z",
    });

    const result = await dispatchDueSchedules(
      { db: env.controlPlaneDb },
      {
        cutoffMinute: new Date("2026-04-28T01:30:00.000Z"),
      },
    );

    expect(result.pendingScheduledActionIds).toHaveLength(1);
    expect(result.claimedScheduleCount).toBe(1);
    expect(result.createdScheduledActionCount).toBe(1);
    expect(result.skippedLateCount).toBe(0);
    expect(result.backlogFastForwardedCount).toBe(0);
    expect(result.reachedMaxBatches).toBe(false);

    const persistedActions = await env.controlPlaneDb.query.scheduledActions.findMany({
      where: (table, { eq }) =>
        eq(table.scheduleId, "sch_integration_new_schedule_interval_collapse"),
      orderBy: (table, { asc }) => [asc(table.scheduledAt)],
    });
    expect(persistedActions).toEqual([
      expect.objectContaining({
        scheduleId: "sch_integration_new_schedule_interval_collapse",
        scheduledAt: "2026-04-28 01:30:00+00",
        status: ScheduledActionStatuses.PENDING,
      }),
    ]);

    const persistedSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, "sch_integration_new_schedule_interval_collapse"),
    });
    expect(persistedSchedule).toEqual(
      expect.objectContaining({
        lastScheduledAt: "2026-04-28 01:30:00+00",
        nextScheduledAt: "2026-04-28 01:40:00+00",
      }),
    );
  });

  it("fast-forwards skipped-late interval backlog to the catch-up window boundary", async ({
    env,
  }) => {
    await seedOrganizationAndTrigger({
      env,
      organizationId: "org_integration_new_schedule_late_interval",
      triggerId: "atm_integration_new_schedule_late_interval",
    });
    await seedTriggerSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_late_interval",
      organizationId: "org_integration_new_schedule_late_interval",
      triggerId: "atm_integration_new_schedule_late_interval",
      cronExpression: "* * * * *",
      nextScheduledAt: "2026-03-01T00:00:00.000Z",
    });

    const result = await dispatchDueSchedules(
      { db: env.controlPlaneDb },
      {
        cutoffMinute: new Date("2026-04-01T00:00:00.000Z"),
      },
    );

    expect(result.pendingScheduledActionIds).toHaveLength(1);
    expect(result.claimedScheduleCount).toBe(2);
    expect(result.createdScheduledActionCount).toBe(2);
    expect(result.skippedLateCount).toBe(1);
    expect(result.backlogFastForwardedCount).toBe(1);
    expect(result.reachedMaxBatches).toBe(false);

    const persistedActions = await env.controlPlaneDb.query.scheduledActions.findMany({
      where: (table, { eq }) => eq(table.scheduleId, "sch_integration_new_schedule_late_interval"),
      orderBy: (table, { asc }) => [asc(table.scheduledAt)],
    });
    expect(persistedActions).toEqual([
      expect.objectContaining({
        scheduleId: "sch_integration_new_schedule_late_interval",
        scheduledAt: "2026-03-01 00:00:00+00",
        skippedFromScheduledAt: "2026-03-01 00:00:00+00",
        skippedUntilScheduledAt: "2026-03-30 23:59:00+00",
        status: ScheduledActionStatuses.SKIPPED_LATE,
      }),
      expect.objectContaining({
        scheduleId: "sch_integration_new_schedule_late_interval",
        scheduledAt: "2026-04-01 00:00:00+00",
        status: ScheduledActionStatuses.PENDING,
      }),
    ]);

    const persistedSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, "sch_integration_new_schedule_late_interval"),
    });
    expect(persistedSchedule).toEqual(
      expect.objectContaining({
        lastScheduledAt: "2026-04-01 00:00:00+00",
        nextScheduledAt: "2026-04-01 00:01:00+00",
      }),
    );
  });

  it("disables finite schedules when there is no future occurrence within endAt", async ({
    env,
  }) => {
    await seedOrganizationAndTrigger({
      env,
      organizationId: "org_integration_new_schedule_finite",
      triggerId: "atm_integration_new_schedule_finite",
    });
    await seedTriggerSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_finite",
      organizationId: "org_integration_new_schedule_finite",
      triggerId: "atm_integration_new_schedule_finite",
      endAt: "2026-04-28T01:00:00.000Z",
      nextScheduledAt: "2026-04-28T01:00:00.000Z",
    });

    await dispatchDueSchedules(
      { db: env.controlPlaneDb },
      {
        cutoffMinute: new Date("2026-04-28T01:00:00.000Z"),
      },
    );

    const persistedSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, "sch_integration_new_schedule_finite"),
    });
    expect(persistedSchedule).toEqual(
      expect.objectContaining({
        enabled: false,
        lastScheduledAt: "2026-04-28 01:00:00+00",
        nextScheduledAt: null,
      }),
    );
  });

  it("snapshots sandbox profile refresh target payloads", async ({ env }) => {
    await env.controlPlaneDb.insert(env.controlPlaneTables.organizations).values({
      id: "org_integration_new_schedule_snapshot",
      name: "org_integration_new_schedule_snapshot",
      slug: "org_integration_new_schedule_snapshot",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_integration_new_schedule_snapshot",
      organizationId: "org_integration_new_schedule_snapshot",
      displayName: "Snapshot schedule profile",
      status: "active",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
      sandboxProfileId: "sbp_integration_new_schedule_snapshot",
      version: 3,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.schedules).values({
      id: "sch_integration_new_schedule_snapshot",
      organizationId: "org_integration_new_schedule_snapshot",
      targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
      name: "Snapshot refresh",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
      enabled: true,
      nextScheduledAt: "2026-04-28T01:00:00.000Z",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileSnapshotRefreshScheduleTargets)
      .values({
        scheduleId: "sch_integration_new_schedule_snapshot",
        sandboxProfileId: "sbp_integration_new_schedule_snapshot",
        sandboxProfileVersion: 3,
      });

    const result = await dispatchDueSchedules(
      { db: env.controlPlaneDb },
      {
        cutoffMinute: new Date("2026-04-28T01:00:00.000Z"),
      },
    );

    expect(result.pendingScheduledActionIds).toHaveLength(1);
    expect(result.createdScheduledActionCount).toBe(1);
    const persistedActions = await env.controlPlaneDb.query.scheduledActions.findMany({
      where: (table, { eq }) => eq(table.scheduleId, "sch_integration_new_schedule_snapshot"),
      orderBy: (table, { asc }) => [asc(table.id)],
    });
    expect(persistedActions).toEqual([
      expect.objectContaining({
        scheduleId: "sch_integration_new_schedule_snapshot",
        targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
        targetPayload: {
          sandboxProfileId: "sbp_integration_new_schedule_snapshot",
          sandboxProfileVersion: 3,
        },
        status: ScheduledActionStatuses.PENDING,
      }),
    ]);
  });
});

async function seedOrganizationAndTrigger(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  triggerId: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: input.organizationId,
    name: input.organizationId,
    slug: input.organizationId,
  });
  await seedTrigger(input);
}

async function seedTrigger(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  triggerId: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggers).values({
    id: input.triggerId,
    organizationId: input.organizationId,
    kind: TriggerKinds.WEBHOOK,
    name: input.triggerId,
    enabled: true,
  });
}

async function seedTriggerSchedule(input: {
  env: IntegrationTestEnvironment;
  scheduleId: string;
  organizationId: string;
  triggerId: string;
  cronExpression?: string;
  enabled?: boolean;
  nextScheduledAt: string | null;
  endAt?: string;
  deletedAt?: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.TRIGGER_RUN,
    name: input.scheduleId,
    cronExpression: input.cronExpression ?? "0 9 * * *",
    timezone: "Asia/Singapore",
    enabled: input.enabled ?? true,
    nextScheduledAt: input.nextScheduledAt,
    ...(input.endAt === undefined ? {} : { endAt: input.endAt }),
    ...(input.deletedAt === undefined ? {} : { deletedAt: input.deletedAt }),
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.scheduleTriggers).values({
    scheduleId: input.scheduleId,
    triggerId: input.triggerId,
    inputTemplate: "{}",
    conversationKeyTemplate: `conversation-${input.scheduleId}`,
    idempotencyKeyTemplate: `idempotency-${input.scheduleId}`,
  });
}
