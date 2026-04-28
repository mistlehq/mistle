import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  type ControlPlaneDatabase,
  scheduledActions,
  ScheduledActionStatuses,
  type ScheduleTargetType,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import { eq, sql } from "drizzle-orm";

import { claimScheduledActionForDispatch } from "./claim-scheduled-action.js";
import { dispatchSnapshotRefreshScheduledAction } from "./dispatch-snapshot-refresh.js";

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

export async function dispatchScheduledAction(
  ctx: {
    db: ControlPlaneDatabase;
    dataPlaneClient: DataPlaneSandboxInstancesClient;
    defaultBaseImage: string;
  },
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

  const targetResult = await dispatchScheduleTarget(ctx, targetType, {
    scheduledActionId: claim.scheduledActionId,
    organizationId: claim.organizationId,
    scheduleId: claim.scheduleId,
    targetPayload: claim.targetPayload,
  });
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
  ctx: {
    db: ControlPlaneDatabase;
    dataPlaneClient: DataPlaneSandboxInstancesClient;
    defaultBaseImage: string;
  },
  targetType: ScheduleTargetType,
  input: ScheduleDispatchTargetHandlerInput,
): Promise<ScheduleDispatchTargetHandlerResult> {
  if (targetType === ScheduleTargetTypes.SNAPSHOT_REFRESH) {
    return dispatchSnapshotRefreshScheduledAction(ctx, input);
  }

  throw new Error(`No schedule dispatch target handler is registered for ${targetType}.`);
}

function parseScheduleTargetType(targetType: string): ScheduleTargetType | null {
  if (targetType === ScheduleTargetTypes.AUTOMATION_RUN) {
    return ScheduleTargetTypes.AUTOMATION_RUN;
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
  const updatedRows = await ctx.db
    .update(scheduledActions)
    .set({
      status: ScheduledActionStatuses.DISPATCHED,
      dispatchedAt: sql`now()`,
      targetWorkflowId: input.targetWorkflowId,
      targetWorkflowStartedAt: sql`coalesce(${scheduledActions.targetWorkflowStartedAt}, now())`,
    })
    .where(eq(scheduledActions.id, input.scheduledActionId))
    .returning({
      id: scheduledActions.id,
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
  const updatedRows = await ctx.db
    .update(scheduledActions)
    .set({
      status: ScheduledActionStatuses.FAILED,
      failedAt: sql`now()`,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
    })
    .where(eq(scheduledActions.id, input.scheduledActionId))
    .returning({
      id: scheduledActions.id,
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
