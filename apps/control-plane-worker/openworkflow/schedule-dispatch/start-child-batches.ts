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

export type StartScheduleDispatchChildBatchesResult = Readonly<{
  scheduledActionIds: string[];
  childBatchCount: number;
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
  const recoveredActionIds = await listRecoverableScheduledActionIds(ctx, {
    cutoffMinute: input.cutoffMinute,
    staleDispatchingBefore: new Date(input.cutoffMinute.getTime() - StaleScheduleDispatchAfterMs),
  });
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

  return {
    scheduledActionIds,
    childBatchCount: childBatches.length,
  };
}

async function listRecoverableScheduledActionIds(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    cutoffMinute: Date;
    staleDispatchingBefore: Date;
  },
): Promise<string[]> {
  const rows = await ctx.db
    .select({
      id: scheduledActions.id,
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

  return rows.map((row) => row.id);
}
