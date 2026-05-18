import {
  TriggerRunStatuses,
  type TriggerRunStatus,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import { TriggerRunFailureCodes, createTriggerRunExecutionError } from "../shared/trigger-run.js";

export type TransitionTriggerRunToRunningInput = {
  triggerRunId: string;
};

export type TransitionTriggerRunToRunningOutput = {
  shouldProcess: boolean;
};

const TerminalTriggerRunStatuses = new Set<TriggerRunStatus>([
  TriggerRunStatuses.COMPLETED,
  TriggerRunStatuses.FAILED,
  TriggerRunStatuses.IGNORED,
  TriggerRunStatuses.DUPLICATE,
]);

export async function transitionTriggerRunToRunning(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: TransitionTriggerRunToRunningInput,
): Promise<TransitionTriggerRunToRunningOutput> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const transitionedRows = await ctx.db
    .update(tables.triggerRuns)
    .set({
      status: TriggerRunStatuses.RUNNING,
      startedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.triggerRuns.id, input.triggerRunId),
        eq(tables.triggerRuns.status, TriggerRunStatuses.QUEUED),
      ),
    )
    .returning();

  const transitionedRun = transitionedRows[0];
  if (transitionedRun !== undefined) {
    return {
      shouldProcess: true,
    };
  }

  const existingRun = await ctx.db.query.triggerRuns.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.triggerRunId),
  });
  if (existingRun === undefined) {
    throw createTriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_NOT_FOUND,
      message: `Trigger run '${input.triggerRunId}' was not found.`,
    });
  }

  if (TerminalTriggerRunStatuses.has(existingRun.status)) {
    return {
      shouldProcess: false,
    };
  }

  if (existingRun.status === TriggerRunStatuses.RUNNING) {
    return {
      shouldProcess: true,
    };
  }

  throw createTriggerRunExecutionError({
    code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
    message: `Trigger run '${input.triggerRunId}' is in unsupported status '${existingRun.status}'.`,
  });
}
