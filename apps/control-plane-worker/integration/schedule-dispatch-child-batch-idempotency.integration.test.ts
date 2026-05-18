/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  TriggerKinds,
  ScheduledActionStatuses,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { startScheduleDispatchChildBatches } from "../openworkflow/schedule-dispatch/start-child-batches.js";

const it = createIntegrationTest({
  services: ["control-plane-worker"],
});

describe.concurrent("control-plane worker schedule dispatch child batch idempotency", () => {
  it("starts the same recovered child batch idempotently across repeated scans", async ({
    env,
  }) => {
    await seedTriggerSchedule({
      env,
      organizationId: "org_integration_schedule_batch_idempotent",
      triggerId: "atm_integration_schedule_batch_idempotent",
      scheduleId: "sch_integration_schedule_batch_idempotent",
    });
    await seedScheduledAction({
      env,
      id: "sca_integration_schedule_batch_idempotent",
      organizationId: "org_integration_schedule_batch_idempotent",
      scheduleId: "sch_integration_schedule_batch_idempotent",
      triggerId: "atm_integration_schedule_batch_idempotent",
      scheduledAt: "2026-04-28T00:10:00.000Z",
      localScheduledTime: "08:10",
    });

    const input = {
      cutoffMinute: new Date("2026-04-28T00:10:00.000Z"),
      scheduledActionIds: [],
    };

    const firstScan = await startScheduleDispatchChildBatches(
      {
        db: env.controlPlaneDb,
        openWorkflow: env.controlPlaneWorkflow,
      },
      input,
    );
    const secondScan = await startScheduleDispatchChildBatches(
      {
        db: env.controlPlaneDb,
        openWorkflow: env.controlPlaneWorkflow,
      },
      input,
    );

    expect(firstScan).toEqual(secondScan);
  });
});

async function seedTriggerSchedule(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  triggerId: string;
  scheduleId: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: input.organizationId,
    name: input.organizationId,
    slug: input.organizationId,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggers).values({
    id: input.triggerId,
    organizationId: input.organizationId,
    kind: TriggerKinds.SCHEDULE,
    name: input.triggerId,
    enabled: true,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.TRIGGER_RUN,
    name: input.scheduleId,
    cronExpression: "0 9 * * *",
    timezone: "Asia/Singapore",
    enabled: true,
    nextScheduledAt: "2026-04-29T01:00:00.000Z",
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.scheduleTriggers).values({
    scheduleId: input.scheduleId,
    triggerId: input.triggerId,
    inputTemplate: "{}",
    conversationKeyTemplate: `conversation-${input.scheduleId}`,
    idempotencyKeyTemplate: `idempotency-${input.scheduleId}`,
  });
}

async function seedScheduledAction(input: {
  env: IntegrationTestEnvironment;
  id: string;
  organizationId: string;
  scheduleId: string;
  triggerId: string;
  scheduledAt: string;
  localScheduledTime: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.scheduledActions).values({
    id: input.id,
    scheduleId: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.TRIGGER_RUN,
    targetPayload: {
      triggerId: input.triggerId,
    },
    scheduledAt: input.scheduledAt,
    localScheduledDate: "2026-04-28",
    localScheduledTime: input.localScheduledTime,
    status: ScheduledActionStatuses.PENDING,
  });
}
