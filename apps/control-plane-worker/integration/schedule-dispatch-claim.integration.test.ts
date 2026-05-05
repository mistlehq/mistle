/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  AutomationKinds,
  ScheduledActionStatuses,
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
  it("claims due automation schedules and advances their cursors", async ({ env }) => {
    await seedOrganizationAndAutomation({
      env,
      organizationId: "org_integration_new_schedule_claim",
      automationId: "atm_integration_new_schedule_claim_due",
    });
    await seedAutomation({
      env,
      organizationId: "org_integration_new_schedule_claim",
      automationId: "atm_integration_new_schedule_claim_future",
    });
    await seedAutomation({
      env,
      organizationId: "org_integration_new_schedule_claim",
      automationId: "atm_integration_new_schedule_claim_disabled",
    });
    await seedAutomation({
      env,
      organizationId: "org_integration_new_schedule_claim",
      automationId: "atm_integration_new_schedule_claim_deleted",
    });
    await seedAutomation({
      env,
      organizationId: "org_integration_new_schedule_claim",
      automationId: "atm_integration_new_schedule_claim_no_next",
    });
    await seedAutomationSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_due",
      organizationId: "org_integration_new_schedule_claim",
      automationId: "atm_integration_new_schedule_claim_due",
      nextScheduledAt: "2026-04-28T01:00:00.000Z",
    });
    await seedAutomationSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_future",
      organizationId: "org_integration_new_schedule_claim",
      automationId: "atm_integration_new_schedule_claim_future",
      nextScheduledAt: "2026-04-29T01:00:00.000Z",
    });
    await seedAutomationSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_disabled",
      organizationId: "org_integration_new_schedule_claim",
      automationId: "atm_integration_new_schedule_claim_disabled",
      enabled: false,
      nextScheduledAt: "2026-04-28T01:00:00.000Z",
    });
    await seedAutomationSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_deleted",
      organizationId: "org_integration_new_schedule_claim",
      automationId: "atm_integration_new_schedule_claim_deleted",
      deletedAt: "2026-04-27T00:00:00.000Z",
      nextScheduledAt: "2026-04-28T01:00:00.000Z",
    });
    await seedAutomationSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_no_next",
      organizationId: "org_integration_new_schedule_claim",
      automationId: "atm_integration_new_schedule_claim_no_next",
      nextScheduledAt: null,
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
        targetType: ScheduleTargetTypes.AUTOMATION_RUN,
        targetPayload: {
          automationId: "atm_integration_new_schedule_claim_due",
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
      ]),
    );
  });

  it("does not duplicate scheduled actions when dispatch is retried", async ({ env }) => {
    await seedOrganizationAndAutomation({
      env,
      organizationId: "org_integration_new_schedule_retry",
      automationId: "atm_integration_new_schedule_retry",
    });
    await seedAutomationSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_retry",
      organizationId: "org_integration_new_schedule_retry",
      automationId: "atm_integration_new_schedule_retry",
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

  it("disables finite schedules when there is no future occurrence within endAt", async ({
    env,
  }) => {
    await seedOrganizationAndAutomation({
      env,
      organizationId: "org_integration_new_schedule_finite",
      automationId: "atm_integration_new_schedule_finite",
    });
    await seedAutomationSchedule({
      env,
      scheduleId: "sch_integration_new_schedule_finite",
      organizationId: "org_integration_new_schedule_finite",
      automationId: "atm_integration_new_schedule_finite",
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

async function seedOrganizationAndAutomation(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  automationId: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: input.organizationId,
    name: input.organizationId,
    slug: input.organizationId,
  });
  await seedAutomation(input);
}

async function seedAutomation(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  automationId: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.automations).values({
    id: input.automationId,
    organizationId: input.organizationId,
    kind: AutomationKinds.WEBHOOK,
    name: input.automationId,
    enabled: true,
  });
}

async function seedAutomationSchedule(input: {
  env: IntegrationTestEnvironment;
  scheduleId: string;
  organizationId: string;
  automationId: string;
  enabled?: boolean;
  nextScheduledAt: string | null;
  endAt?: string;
  deletedAt?: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.AUTOMATION_RUN,
    name: input.scheduleId,
    cronExpression: "0 9 * * *",
    timezone: "Asia/Singapore",
    enabled: input.enabled ?? true,
    nextScheduledAt: input.nextScheduledAt,
    ...(input.endAt === undefined ? {} : { endAt: input.endAt }),
    ...(input.deletedAt === undefined ? {} : { deletedAt: input.deletedAt }),
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.scheduleAutomations).values({
    scheduleId: input.scheduleId,
    automationId: input.automationId,
    inputTemplate: "{}",
    conversationKeyTemplate: `conversation-${input.scheduleId}`,
    idempotencyKeyTemplate: `idempotency-${input.scheduleId}`,
  });
}
