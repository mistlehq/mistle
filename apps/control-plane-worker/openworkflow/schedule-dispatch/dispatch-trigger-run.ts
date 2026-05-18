import {
  TriggerRunStatuses,
  ControlPlaneConstraintIds,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
  isControlPlaneUniqueViolation,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import { HandleTriggerRunWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import type { OpenWorkflow } from "openworkflow";
import { z } from "zod";

import type {
  ScheduleDispatchTargetHandlerInput,
  ScheduleDispatchTargetHandlerResult,
} from "./dispatch-scheduled-action.js";
import { ScheduleDispatchPermanentError } from "./schedule-dispatch-permanent-error.js";

const TriggerRunTargetPayloadSchema = z
  .object({
    triggerId: z.string().min(1),
  })
  .strict();

type WorkflowRunClient = Pick<OpenWorkflow, "runWorkflow">;

type TriggerRunHandoffAggregate = Readonly<{
  triggerId: string;
  triggerTargetId: string;
}>;

export async function dispatchTriggerRunScheduledAction(
  ctx: {
    db: ControlPlaneDatabase;
    openWorkflow: WorkflowRunClient;
  },
  input: ScheduleDispatchTargetHandlerInput,
): Promise<ScheduleDispatchTargetHandlerResult> {
  const targetPayloadResult = TriggerRunTargetPayloadSchema.safeParse(input.targetPayload);
  if (!targetPayloadResult.success) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "invalid_schedule_target_payload",
      message: `Scheduled trigger action '${input.scheduledActionId}' has invalid target payload.`,
      cause: targetPayloadResult.error,
    });
  }

  const aggregate = await loadTriggerRunHandoffAggregate(ctx, {
    triggerId: targetPayloadResult.data.triggerId,
    organizationId: input.organizationId,
    scheduleId: input.scheduleId,
    scheduledActionId: input.scheduledActionId,
  });
  const triggerRun = await createOrResolveTriggerRun(ctx, {
    triggerId: aggregate.triggerId,
    triggerTargetId: aggregate.triggerTargetId,
    scheduledActionId: input.scheduledActionId,
  });

  const handle = await ctx.openWorkflow.runWorkflow(
    HandleTriggerRunWorkflowSpec,
    {
      triggerRunId: triggerRun.id,
    },
    {
      idempotencyKey: triggerRun.id,
    },
  );

  return {
    targetWorkflowId: handle.workflowRun.id,
  };
}

async function loadTriggerRunHandoffAggregate(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    triggerId: string;
    organizationId: string;
    scheduleId: string;
    scheduledActionId: string;
  },
): Promise<TriggerRunHandoffAggregate> {
  const schedule = await ctx.db.query.schedules.findFirst({
    where: (table, { eq }) => eq(table.id, input.scheduleId),
  });
  if (schedule === undefined) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "schedule_not_found",
      message: `Schedule '${input.scheduleId}' for scheduled action '${input.scheduledActionId}' was not found.`,
    });
  }
  if (schedule.organizationId !== input.organizationId) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "organization_mismatch",
      message: `Schedule '${schedule.id}' organization does not match scheduled action '${input.scheduledActionId}'.`,
    });
  }
  if (schedule.targetType !== ScheduleTargetTypes.TRIGGER_RUN) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "target_type_mismatch",
      message: `Schedule '${schedule.id}' target type '${schedule.targetType}' does not match trigger run dispatch.`,
    });
  }
  if (!schedule.enabled) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "schedule_disabled",
      message: `Schedule '${schedule.id}' is disabled.`,
    });
  }
  if (schedule.deletedAt !== null) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "schedule_deleted",
      message: `Schedule '${schedule.id}' is deleted.`,
    });
  }

  const scheduleTrigger = await ctx.db.query.scheduleTriggers.findFirst({
    where: (table, { eq }) => eq(table.scheduleId, schedule.id),
  });
  if (scheduleTrigger === undefined) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "schedule_trigger_not_found",
      message: `Schedule trigger target for schedule '${schedule.id}' was not found.`,
    });
  }
  if (scheduleTrigger.triggerId !== input.triggerId) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "target_payload_trigger_mismatch",
      message: `Scheduled action '${input.scheduledActionId}' payload trigger '${input.triggerId}' does not match schedule trigger '${scheduleTrigger.triggerId}'.`,
    });
  }

  const trigger = await ctx.db.query.triggers.findFirst({
    where: (table, { eq }) => eq(table.id, scheduleTrigger.triggerId),
  });
  if (trigger === undefined) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "trigger_not_found",
      message: `Trigger '${scheduleTrigger.triggerId}' was not found.`,
    });
  }
  if (trigger.organizationId !== input.organizationId) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "organization_mismatch",
      message: `Trigger '${trigger.id}' organization does not match scheduled action '${input.scheduledActionId}'.`,
    });
  }
  if (!trigger.enabled) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "trigger_disabled",
      message: `Trigger '${trigger.id}' is disabled.`,
    });
  }

  const triggerTarget = await ctx.db.query.triggerTargets.findFirst({
    where: (table, { eq }) => eq(table.triggerId, trigger.id),
  });
  if (triggerTarget === undefined) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "trigger_target_not_found",
      message: `Trigger target for trigger '${trigger.id}' was not found.`,
    });
  }

  return {
    triggerId: trigger.id,
    triggerTargetId: triggerTarget.id,
  };
}

async function createOrResolveTriggerRun(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    triggerId: string;
    triggerTargetId: string;
    scheduledActionId: string;
  },
): Promise<{ id: string }> {
  try {
    const tables = getControlPlaneDatabaseSchema(ctx.db);
    const [triggerRun] = await ctx.db
      .insert(tables.triggerRuns)
      .values({
        triggerId: input.triggerId,
        triggerTargetId: input.triggerTargetId,
        sourceScheduledActionId: input.scheduledActionId,
        status: TriggerRunStatuses.QUEUED,
      })
      .returning({
        id: tables.triggerRuns.id,
      });

    if (triggerRun === undefined) {
      throw new Error(
        `Expected trigger run to be created for scheduled action '${input.scheduledActionId}'.`,
      );
    }

    return triggerRun;
  } catch (error) {
    if (
      isControlPlaneUniqueViolation(
        error,
        ControlPlaneConstraintIds.TRIGGER_RUN_SOURCE_SCHEDULED_ACTION,
      )
    ) {
      return loadTriggerRunForScheduledAction(ctx, input.scheduledActionId);
    }

    throw error;
  }
}

async function loadTriggerRunForScheduledAction(
  ctx: {
    db: ControlPlaneDatabase;
  },
  scheduledActionId: string,
): Promise<{ id: string }> {
  const triggerRun = await ctx.db.query.triggerRuns.findFirst({
    columns: {
      id: true,
    },
    where: (table, { eq }) => eq(table.sourceScheduledActionId, scheduledActionId),
  });
  if (triggerRun === undefined) {
    throw new Error(
      `Expected trigger run for scheduled action '${scheduledActionId}' to exist after source uniqueness conflict.`,
    );
  }

  return triggerRun;
}
