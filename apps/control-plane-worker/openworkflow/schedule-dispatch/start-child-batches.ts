import {
  type ControlPlaneDatabase,
  scheduledActions,
  ScheduledActionStatuses,
} from "@mistle/db/control-plane";
import { ScheduleDispatchBatchWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { and, eq, isNull, lt, lte, or } from "drizzle-orm";
import type { OpenWorkflow } from "openworkflow";

import {
  createScheduleDispatchBatchIdempotencyKey,
  partitionScheduledActionIds,
  ScheduleDispatchChildBatchSize,
  StaleScheduleDispatchAfterMs,
} from "./batches.js";
import { recordChildWorkflowsStarted, recordRecoveredScheduledActions } from "./telemetry.js";

type RecoverableScheduledActionRow = Readonly<{
  id: string;
  status: typeof ScheduledActionStatuses.PENDING | typeof ScheduledActionStatuses.DISPATCHING;
}>;

export type StartScheduleDispatchChildBatchesResult = Readonly<{
  scheduledActionIds: string[];
  childBatchCount: number;
  pendingRecoveredCount: number;
  staleDispatchingRecoveredCount: number;
}>;

export async function startScheduleDispatchChildBatches(
  ctx: {
    db: ControlPlaneDatabase;
    openWorkflow: OpenWorkflow;
  },
  input: {
    cutoffMinute: Date;
    scheduledActionIds: readonly string[];
  },
): Promise<StartScheduleDispatchChildBatchesResult> {
  const recoveredActions = await listRecoverableScheduledActions(ctx, {
    cutoffMinute: input.cutoffMinute,
    staleDispatchingBefore: new Date(input.cutoffMinute.getTime() - StaleScheduleDispatchAfterMs),
  });
  const inputActionIds = new Set(input.scheduledActionIds);
  const recoveredActionIds = recoveredActions.map((action) => action.id);
  const pendingRecoveredCount = recoveredActions.filter(
    (action) => !inputActionIds.has(action.id) && action.status === ScheduledActionStatuses.PENDING,
  ).length;
  const staleDispatchingRecoveredCount = recoveredActions.filter(
    (action) =>
      !inputActionIds.has(action.id) && action.status === ScheduledActionStatuses.DISPATCHING,
  ).length;
  const scheduledActionIds = [
    ...new Set([...input.scheduledActionIds, ...recoveredActionIds]),
  ].sort();
  const childBatches = partitionScheduledActionIds({
    scheduledActionIds,
    batchSize: ScheduleDispatchChildBatchSize,
  });

  for (const childBatch of childBatches) {
    await ctx.openWorkflow.runWorkflow(
      ScheduleDispatchBatchWorkflowSpec,
      {
        scheduledActionIds: childBatch,
      },
      {
        idempotencyKey: createScheduleDispatchBatchIdempotencyKey(childBatch),
      },
    );
  }
  recordRecoveredScheduledActions({
    pendingCount: pendingRecoveredCount,
    staleDispatchingCount: staleDispatchingRecoveredCount,
  });
  recordChildWorkflowsStarted(childBatches.length);

  return {
    scheduledActionIds,
    childBatchCount: childBatches.length,
    pendingRecoveredCount,
    staleDispatchingRecoveredCount,
  };
}

async function listRecoverableScheduledActions(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    cutoffMinute: Date;
    staleDispatchingBefore: Date;
  },
): Promise<RecoverableScheduledActionRow[]> {
  const rows = await ctx.db
    .select({
      id: scheduledActions.id,
      status: scheduledActions.status,
    })
    .from(scheduledActions)
    .where(
      and(
        lte(scheduledActions.scheduledAt, input.cutoffMinute.toISOString()),
        or(
          eq(scheduledActions.status, ScheduledActionStatuses.PENDING),
          and(
            eq(scheduledActions.status, ScheduledActionStatuses.DISPATCHING),
            or(
              isNull(scheduledActions.dispatchingAt),
              lt(scheduledActions.dispatchingAt, input.staleDispatchingBefore.toISOString()),
            ),
          ),
        ),
      ),
    )
    .orderBy(scheduledActions.scheduledAt, scheduledActions.id);

  return rows.map((row) => {
    if (
      row.status !== ScheduledActionStatuses.PENDING &&
      row.status !== ScheduledActionStatuses.DISPATCHING
    ) {
      throw new Error(`Unexpected recoverable scheduled action status: ${row.status}`);
    }

    return {
      id: row.id,
      status: row.status,
    };
  });
}
