/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  ScheduledActionStatuses,
  ScheduleKinds,
  ScheduleTargetTypes,
  TriggerKinds,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { DispatchOneOffScheduleWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-worker", "data-plane-api"],
});

describe.concurrent("control-plane worker one-off schedule dispatch", () => {
  it("dispatches an enabled one-off trigger schedule once and marks the schedule terminal", async ({
    env,
  }) => {
    await seedOneOffTriggerSchedule({
      env,
      organizationId: "org_integration_one_off_dispatch",
      scheduleId: "sch_integration_one_off_dispatch",
      triggerId: "trg_integration_one_off_dispatch",
      scheduledAt: "2026-04-28T01:23:00.000Z",
    });

    const handle = await env.controlPlaneWorkflow.runWorkflow(
      DispatchOneOffScheduleWorkflowSpec,
      {
        scheduleId: "sch_integration_one_off_dispatch",
      },
      {
        idempotencyKey: "integration-one-off-dispatch",
      },
    );
    const result = await handle.result({ timeoutMs: 20_000 });

    expect(result).toEqual({
      scheduleId: "sch_integration_one_off_dispatch",
      scheduledActionId: expect.any(String),
      status: "dispatched",
    });
    if (result.scheduledActionId === null) {
      throw new Error("Expected one-off workflow to create a scheduled action.");
    }
    const scheduledActionId = result.scheduledActionId;

    const persistedSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, "sch_integration_one_off_dispatch"),
    });
    expect(persistedSchedule).toEqual(
      expect.objectContaining({
        kind: ScheduleKinds.ONE_OFF,
        enabled: false,
        nextScheduledAt: null,
        lastScheduledAt: "2026-04-28 01:23:00+00",
      }),
    );

    const persistedAction = await env.controlPlaneDb.query.scheduledActions.findFirst({
      where: (table, { eq }) => eq(table.id, scheduledActionId),
    });
    expect(persistedAction).toEqual(
      expect.objectContaining({
        scheduleId: "sch_integration_one_off_dispatch",
        organizationId: "org_integration_one_off_dispatch",
        targetType: ScheduleTargetTypes.TRIGGER_RUN,
        targetPayload: {
          triggerId: "trg_integration_one_off_dispatch",
        },
        scheduledAt: "2026-04-28 01:23:00+00",
        localScheduledDate: "2026-04-28",
        localScheduledTime: "01:23",
        status: ScheduledActionStatuses.DISPATCHED,
        targetWorkflowId: expect.any(String),
      }),
    );

    const triggerRun = await env.controlPlaneDb.query.triggerRuns.findFirst({
      where: (table, { eq }) => eq(table.sourceScheduledActionId, scheduledActionId),
    });
    expect(triggerRun).toEqual(
      expect.objectContaining({
        triggerId: "trg_integration_one_off_dispatch",
        triggerTargetId: "tgt_sch_integration_one_off_dispatch",
        sourceScheduledActionId: scheduledActionId,
      }),
    );
  });

  it("skips a disabled one-off schedule without creating a scheduled action", async ({ env }) => {
    await seedOneOffTriggerSchedule({
      env,
      organizationId: "org_integration_one_off_disabled",
      scheduleId: "sch_integration_one_off_disabled",
      triggerId: "trg_integration_one_off_disabled",
      scheduledAt: "2026-04-28T01:24:00.000Z",
      enabled: false,
    });

    const handle = await env.controlPlaneWorkflow.runWorkflow(
      DispatchOneOffScheduleWorkflowSpec,
      {
        scheduleId: "sch_integration_one_off_disabled",
      },
      {
        idempotencyKey: "integration-one-off-disabled",
      },
    );
    const result = await handle.result({ timeoutMs: 20_000 });

    expect(result).toEqual({
      scheduleId: "sch_integration_one_off_disabled",
      scheduledActionId: null,
      status: "skipped",
    });

    const persistedActions = await env.controlPlaneDb.query.scheduledActions.findMany({
      where: (table, { eq }) => eq(table.scheduleId, "sch_integration_one_off_disabled"),
    });
    expect(persistedActions).toEqual([]);

    const persistedSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, "sch_integration_one_off_disabled"),
    });
    expect(persistedSchedule).toEqual(
      expect.objectContaining({
        enabled: false,
        nextScheduledAt: "2026-04-28 01:24:00+00",
        lastScheduledAt: null,
      }),
    );
  });
});

async function seedOneOffTriggerSchedule(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  scheduleId: string;
  triggerId: string;
  scheduledAt: string;
  enabled?: boolean;
}): Promise<void> {
  const sandboxProfileId = `sbp_${input.scheduleId}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: input.organizationId,
    name: input.organizationId,
    slug: input.organizationId,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId: input.organizationId,
    displayName: sandboxProfileId,
    status: "active",
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersions)
    .values({
      sandboxProfileId,
      version: 1,
      sandboxProvider: "docker",
      sandboxConnectionId: null,
    });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggers).values({
    id: input.triggerId,
    organizationId: input.organizationId,
    kind: TriggerKinds.SCHEDULE,
    name: input.triggerId,
    enabled: true,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggerTargets).values({
    id: `tgt_${input.scheduleId}`,
    triggerId: input.triggerId,
    sandboxProfileId,
    sandboxProfileVersion: 1,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.TRIGGER_RUN,
    kind: ScheduleKinds.ONE_OFF,
    name: input.scheduleId,
    enabled: input.enabled ?? true,
    nextScheduledAt: input.scheduledAt,
    oneOffWorkflowRunId: `owfr_${input.scheduleId}`,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.scheduleTriggers).values({
    scheduleId: input.scheduleId,
    triggerId: input.triggerId,
    inputTemplate: "{}",
    conversationKeyTemplate: `conversation-${input.scheduleId}`,
    idempotencyKeyTemplate: `idempotency-${input.scheduleId}`,
  });
}
