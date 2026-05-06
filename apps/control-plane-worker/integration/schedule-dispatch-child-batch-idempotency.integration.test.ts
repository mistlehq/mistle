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

import { startScheduleDispatchChildBatches } from "../openworkflow/schedule-dispatch/start-child-batches.js";

const it = createIntegrationTest({
  services: ["control-plane-worker"],
});

describe.concurrent("control-plane worker schedule dispatch child batch idempotency", () => {
  it("starts the same recovered child batch idempotently across repeated scans", async ({
    env,
  }) => {
    await seedAutomationSchedule({
      env,
      organizationId: "org_integration_schedule_batch_idempotent",
      automationId: "atm_integration_schedule_batch_idempotent",
      scheduleId: "sch_integration_schedule_batch_idempotent",
    });
    await seedScheduledAction({
      env,
      id: "sca_integration_schedule_batch_idempotent",
      organizationId: "org_integration_schedule_batch_idempotent",
      scheduleId: "sch_integration_schedule_batch_idempotent",
      automationId: "atm_integration_schedule_batch_idempotent",
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

async function seedAutomationSchedule(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  automationId: string;
  scheduleId: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: input.organizationId,
    name: input.organizationId,
    slug: input.organizationId,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.automations).values({
    id: input.automationId,
    organizationId: input.organizationId,
    kind: AutomationKinds.SCHEDULE,
    name: input.automationId,
    enabled: true,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.AUTOMATION_RUN,
    name: input.scheduleId,
    cronExpression: "0 9 * * *",
    timezone: "Asia/Singapore",
    enabled: true,
    nextScheduledAt: "2026-04-29T01:00:00.000Z",
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.scheduleAutomations).values({
    scheduleId: input.scheduleId,
    automationId: input.automationId,
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
  automationId: string;
  scheduledAt: string;
  localScheduledTime: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.scheduledActions).values({
    id: input.id,
    scheduleId: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.AUTOMATION_RUN,
    targetPayload: {
      automationId: input.automationId,
    },
    scheduledAt: input.scheduledAt,
    localScheduledDate: "2026-04-28",
    localScheduledTime: input.localScheduledTime,
    status: ScheduledActionStatuses.PENDING,
  });
}
