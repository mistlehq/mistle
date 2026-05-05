import {
  AutomationRunStatuses,
  ControlPlaneConstraintIds,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
  isControlPlaneUniqueViolation,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import { HandleAutomationRunWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import type { OpenWorkflow } from "openworkflow";
import { z } from "zod";

import type {
  ScheduleDispatchTargetHandlerInput,
  ScheduleDispatchTargetHandlerResult,
} from "./dispatch-scheduled-action.js";
import { ScheduleDispatchPermanentError } from "./schedule-dispatch-permanent-error.js";

const AutomationRunTargetPayloadSchema = z
  .object({
    automationId: z.string().min(1),
  })
  .strict();

type WorkflowRunClient = Pick<OpenWorkflow, "runWorkflow">;

type AutomationRunHandoffAggregate = Readonly<{
  automationId: string;
  automationTargetId: string;
}>;

export async function dispatchAutomationRunScheduledAction(
  ctx: {
    db: ControlPlaneDatabase;
    openWorkflow: WorkflowRunClient;
  },
  input: ScheduleDispatchTargetHandlerInput,
): Promise<ScheduleDispatchTargetHandlerResult> {
  const targetPayloadResult = AutomationRunTargetPayloadSchema.safeParse(input.targetPayload);
  if (!targetPayloadResult.success) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "invalid_schedule_target_payload",
      message: `Scheduled automation action '${input.scheduledActionId}' has invalid target payload.`,
      cause: targetPayloadResult.error,
    });
  }

  const aggregate = await loadAutomationRunHandoffAggregate(ctx, {
    automationId: targetPayloadResult.data.automationId,
    organizationId: input.organizationId,
    scheduleId: input.scheduleId,
    scheduledActionId: input.scheduledActionId,
  });
  const automationRun = await createOrResolveAutomationRun(ctx, {
    automationId: aggregate.automationId,
    automationTargetId: aggregate.automationTargetId,
    scheduledActionId: input.scheduledActionId,
  });

  const handle = await ctx.openWorkflow.runWorkflow(
    HandleAutomationRunWorkflowSpec,
    {
      automationRunId: automationRun.id,
    },
    {
      idempotencyKey: automationRun.id,
    },
  );

  return {
    targetWorkflowId: handle.workflowRun.id,
  };
}

async function loadAutomationRunHandoffAggregate(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    automationId: string;
    organizationId: string;
    scheduleId: string;
    scheduledActionId: string;
  },
): Promise<AutomationRunHandoffAggregate> {
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
  if (schedule.targetType !== ScheduleTargetTypes.AUTOMATION_RUN) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "target_type_mismatch",
      message: `Schedule '${schedule.id}' target type '${schedule.targetType}' does not match automation run dispatch.`,
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

  const scheduleAutomation = await ctx.db.query.scheduleAutomations.findFirst({
    where: (table, { eq }) => eq(table.scheduleId, schedule.id),
  });
  if (scheduleAutomation === undefined) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "schedule_automation_not_found",
      message: `Schedule automation target for schedule '${schedule.id}' was not found.`,
    });
  }
  if (scheduleAutomation.automationId !== input.automationId) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "target_payload_automation_mismatch",
      message: `Scheduled action '${input.scheduledActionId}' payload automation '${input.automationId}' does not match schedule automation '${scheduleAutomation.automationId}'.`,
    });
  }

  const automation = await ctx.db.query.automations.findFirst({
    where: (table, { eq }) => eq(table.id, scheduleAutomation.automationId),
  });
  if (automation === undefined) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "automation_not_found",
      message: `Automation '${scheduleAutomation.automationId}' was not found.`,
    });
  }
  if (automation.organizationId !== input.organizationId) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "organization_mismatch",
      message: `Automation '${automation.id}' organization does not match scheduled action '${input.scheduledActionId}'.`,
    });
  }
  if (!automation.enabled) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "automation_disabled",
      message: `Automation '${automation.id}' is disabled.`,
    });
  }

  const automationTarget = await ctx.db.query.automationTargets.findFirst({
    where: (table, { eq }) => eq(table.automationId, automation.id),
  });
  if (automationTarget === undefined) {
    throw new ScheduleDispatchPermanentError({
      failureCode: "automation_target_not_found",
      message: `Automation target for automation '${automation.id}' was not found.`,
    });
  }

  return {
    automationId: automation.id,
    automationTargetId: automationTarget.id,
  };
}

async function createOrResolveAutomationRun(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    automationId: string;
    automationTargetId: string;
    scheduledActionId: string;
  },
): Promise<{ id: string }> {
  try {
    const tables = getControlPlaneDatabaseSchema(ctx.db);
    const [automationRun] = await ctx.db
      .insert(tables.automationRuns)
      .values({
        automationId: input.automationId,
        automationTargetId: input.automationTargetId,
        sourceScheduledActionId: input.scheduledActionId,
        status: AutomationRunStatuses.QUEUED,
      })
      .returning({
        id: tables.automationRuns.id,
      });

    if (automationRun === undefined) {
      throw new Error(
        `Expected automation run to be created for scheduled action '${input.scheduledActionId}'.`,
      );
    }

    return automationRun;
  } catch (error) {
    if (
      isControlPlaneUniqueViolation(
        error,
        ControlPlaneConstraintIds.AUTOMATION_RUN_SOURCE_SCHEDULED_ACTION,
      )
    ) {
      return loadAutomationRunForScheduledAction(ctx, input.scheduledActionId);
    }

    throw error;
  }
}

async function loadAutomationRunForScheduledAction(
  ctx: {
    db: ControlPlaneDatabase;
  },
  scheduledActionId: string,
): Promise<{ id: string }> {
  const automationRun = await ctx.db.query.automationRuns.findFirst({
    columns: {
      id: true,
    },
    where: (table, { eq }) => eq(table.sourceScheduledActionId, scheduledActionId),
  });
  if (automationRun === undefined) {
    throw new Error(
      `Expected automation run for scheduled action '${scheduledActionId}' to exist after source uniqueness conflict.`,
    );
  }

  return automationRun;
}
