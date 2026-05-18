import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  type ControlPlaneDatabase,
  ScheduledActionStatuses,
  type ScheduleTargetType,
  ScheduleTargetTypes,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { eq, sql } from "drizzle-orm";
import type { OpenWorkflow } from "openworkflow";

import { claimScheduledActionForDispatch } from "./claim-scheduled-action.js";
import { dispatchSnapshotRefreshScheduledAction } from "./dispatch-snapshot-refresh.js";
import { dispatchTriggerRunScheduledAction } from "./dispatch-trigger-run.js";
import { ScheduleDispatchPermanentError } from "./schedule-dispatch-permanent-error.js";
import { recordScheduleTargetHandoffFailure } from "./telemetry.js";

export type ScheduleDispatchTargetHandlerInput = Readonly<{
  scheduledActionId: string;
  organizationId: string;
  scheduleId: string;
  targetPayload: Record<string, unknown>;
}>;

export type ScheduleDispatchTargetHandlerResult = Readonly<{
  targetWorkflowId: string | null;
}>;

export type DispatchScheduledActionResult = Readonly<{
  scheduledActionId: string;
  status: "dispatched" | "failed" | "skipped";
}>;

type WorkflowRunClient = Pick<OpenWorkflow, "runWorkflow">;

type DispatchScheduledActionContext = Readonly<{
  db: ControlPlaneDatabase;
  dataPlaneClient: DataPlaneSandboxInstancesClient;
  defaultBaseImage: string;
  openWorkflow?: WorkflowRunClient;
}>;

export async function dispatchScheduledAction(
  ctx: DispatchScheduledActionContext,
  input: {
    scheduledActionId: string;
    dispatchClaimKey: string;
    staleDispatchingBefore: Date;
  },
): Promise<DispatchScheduledActionResult> {
  const claim = await claimScheduledActionForDispatch(ctx, input);

  if (claim.status !== "claimed") {
    return {
      scheduledActionId: input.scheduledActionId,
      status: "skipped",
    };
  }

  if (claim.targetWorkflowStartedAt !== null) {
    await markScheduledActionDispatched(ctx, {
      scheduledActionId: claim.scheduledActionId,
      targetWorkflowId: claim.targetWorkflowId,
    });
    return {
      scheduledActionId: claim.scheduledActionId,
      status: "dispatched",
    };
  }

  const targetType = parseScheduleTargetType(claim.targetType);
  if (targetType === null) {
    await markScheduledActionFailed(ctx, {
      scheduledActionId: claim.scheduledActionId,
      failureCode: "unsupported_target_type",
      failureMessage: `Unsupported schedule target type: ${claim.targetType}`,
    });
    return {
      scheduledActionId: claim.scheduledActionId,
      status: "failed",
    };
  }

  const targetHandlerInput = {
    scheduledActionId: claim.scheduledActionId,
    organizationId: claim.organizationId,
    scheduleId: claim.scheduleId,
    targetPayload: claim.targetPayload,
  };
  let targetResult: ScheduleDispatchTargetHandlerResult;
  try {
    targetResult = await dispatchScheduleTarget(ctx, targetType, targetHandlerInput);
  } catch (error) {
    if (error instanceof ScheduleDispatchPermanentError) {
      await markScheduledActionFailed(ctx, {
        scheduledActionId: claim.scheduledActionId,
        failureCode: error.failureCode,
        failureMessage: error.message,
      });
      return {
        scheduledActionId: claim.scheduledActionId,
        status: "failed",
      };
    }

    recordScheduleTargetHandoffFailure({
      error,
      scheduledActionId: claim.scheduledActionId,
      scheduleId: claim.scheduleId,
      targetType,
    });
    throw error;
  }
  await markScheduledActionDispatched(ctx, {
    scheduledActionId: claim.scheduledActionId,
    targetWorkflowId: targetResult.targetWorkflowId,
  });

  return {
    scheduledActionId: claim.scheduledActionId,
    status: "dispatched",
  };
}

async function dispatchScheduleTarget(
  ctx: DispatchScheduledActionContext,
  targetType: ScheduleTargetType,
  input: ScheduleDispatchTargetHandlerInput,
): Promise<ScheduleDispatchTargetHandlerResult> {
  if (targetType === ScheduleTargetTypes.SNAPSHOT_REFRESH) {
    return dispatchSnapshotRefreshScheduledAction(ctx, input);
  }
  if (targetType === ScheduleTargetTypes.TRIGGER_RUN) {
    if (ctx.openWorkflow === undefined) {
      throw new Error("Schedule trigger run dispatch requires OpenWorkflow.");
    }

    return dispatchTriggerRunScheduledAction(
      {
        db: ctx.db,
        openWorkflow: ctx.openWorkflow,
      },
      input,
    );
  }

  targetType satisfies never;
  throw new Error("No schedule dispatch target handler is registered.");
}

function parseScheduleTargetType(targetType: string): ScheduleTargetType | null {
  if (targetType === ScheduleTargetTypes.TRIGGER_RUN) {
    return ScheduleTargetTypes.TRIGGER_RUN;
  }
  if (targetType === ScheduleTargetTypes.SNAPSHOT_REFRESH) {
    return ScheduleTargetTypes.SNAPSHOT_REFRESH;
  }

  return null;
}

async function markScheduledActionDispatched(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    scheduledActionId: string;
    targetWorkflowId: string | null;
  },
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const updatedRows = await ctx.db
    .update(tables.scheduledActions)
    .set({
      status: ScheduledActionStatuses.DISPATCHED,
      dispatchedAt: sql`now()`,
      targetWorkflowId: input.targetWorkflowId,
      targetWorkflowStartedAt: sql`coalesce(${tables.scheduledActions.targetWorkflowStartedAt}, now())`,
    })
    .where(eq(tables.scheduledActions.id, input.scheduledActionId))
    .returning({
      id: tables.scheduledActions.id,
    });

  assertSingleScheduledActionUpdate(updatedRows, input.scheduledActionId);
}

async function markScheduledActionFailed(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    scheduledActionId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const updatedRows = await ctx.db
    .update(tables.scheduledActions)
    .set({
      status: ScheduledActionStatuses.FAILED,
      failedAt: sql`now()`,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
    })
    .where(eq(tables.scheduledActions.id, input.scheduledActionId))
    .returning({
      id: tables.scheduledActions.id,
    });

  assertSingleScheduledActionUpdate(updatedRows, input.scheduledActionId);
}

function assertSingleScheduledActionUpdate(
  rows: readonly { id: string }[],
  scheduledActionId: string,
): void {
  if (rows.length !== 1) {
    throw new Error(
      `Expected to update scheduled action ${scheduledActionId}, updated ${String(rows.length)} rows.`,
    );
  }
}
