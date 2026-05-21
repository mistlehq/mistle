import {
  ScheduleKinds,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { DispatchOneOffScheduleWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { eq, sql } from "drizzle-orm";
import type { OpenWorkflow } from "openworkflow";

type OneOffScheduleWorkflowRunner = Pick<OpenWorkflow, "runWorkflow">;
type OneOffScheduleWorkflowCanceler = Pick<OpenWorkflow, "cancelWorkflowRun">;

export async function enqueueOneOffScheduleWorkflow(
  ctx: {
    db: ControlPlaneDatabase;
    openWorkflow: OneOffScheduleWorkflowRunner;
  },
  input: {
    scheduleId: string;
    availableAt: Date;
  },
): Promise<string> {
  const handle = await ctx.openWorkflow.runWorkflow(
    DispatchOneOffScheduleWorkflowSpec,
    {
      scheduleId: input.scheduleId,
    },
    {
      availableAt: input.availableAt,
      idempotencyKey: createOneOffScheduleWorkflowIdempotencyKey(input.scheduleId),
    },
  );
  const workflowRunId = handle.workflowRun.id;

  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const updatedRows = await ctx.db
    .update(tables.schedules)
    .set({
      oneOffWorkflowRunId: workflowRunId,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.schedules.id, input.scheduleId))
    .returning({
      id: tables.schedules.id,
    });

  if (updatedRows.length !== 1) {
    throw new Error(`Expected to store workflow run for one-off schedule '${input.scheduleId}'.`);
  }

  return workflowRunId;
}

export async function cancelPendingOneOffScheduleWorkflow(
  ctx: {
    openWorkflow: OneOffScheduleWorkflowCanceler;
  },
  input: {
    scheduleId: string;
    workflowRunId: string | null;
    wasPendingExecution: boolean;
  },
): Promise<void> {
  if (!input.wasPendingExecution) {
    return;
  }
  if (input.workflowRunId === null) {
    throw new Error(`Pending one-off schedule '${input.scheduleId}' is missing workflow run id.`);
  }

  await ctx.openWorkflow.cancelWorkflowRun(input.workflowRunId);
}

export function createOneOffScheduleWorkflowIdempotencyKey(scheduleId: string): string {
  return `${ScheduleKinds.ONE_OFF}:schedule:${scheduleId}`;
}
