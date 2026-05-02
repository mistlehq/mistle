import {
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  type ScheduledActionStatus,
  ScheduledActionStatuses,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

export type ScheduledActionDispatchClaimResult =
  | Readonly<{
      status: "claimed";
      scheduledActionId: string;
      organizationId: string;
      scheduleId: string;
      targetType: string;
      targetPayload: Record<string, unknown>;
      previousStatus: ScheduledActionStatus;
      previousDispatchClaimKey: string | null;
      previousDispatchingAt: string | null;
      targetWorkflowId: string | null;
      targetWorkflowStartedAt: string | null;
    }>
  | Readonly<{
      status: "actively-dispatching";
      scheduledActionId: string;
    }>
  | Readonly<{
      status: "already-finalized";
      scheduledActionId: string;
      scheduledActionStatus: ScheduledActionStatus;
    }>
  | Readonly<{
      status: "missing";
      scheduledActionId: string;
    }>;

export async function claimScheduledActionForDispatch(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    scheduledActionId: string;
    dispatchClaimKey: string;
    staleDispatchingBefore: Date;
  },
): Promise<ScheduledActionDispatchClaimResult> {
  return ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

    const candidateRows = await tx
      .select({
        id: tables.scheduledActions.id,
        organizationId: tables.scheduledActions.organizationId,
        scheduleId: tables.scheduledActions.scheduleId,
        targetType: tables.scheduledActions.targetType,
        targetPayload: tables.scheduledActions.targetPayload,
        previousStatus: tables.scheduledActions.status,
        previousDispatchClaimKey: tables.scheduledActions.dispatchClaimKey,
        previousDispatchingAt: tables.scheduledActions.dispatchingAt,
        targetWorkflowId: tables.scheduledActions.targetWorkflowId,
        targetWorkflowStartedAt: tables.scheduledActions.targetWorkflowStartedAt,
      })
      .from(tables.scheduledActions)
      .where(
        and(
          eq(tables.scheduledActions.id, input.scheduledActionId),
          or(
            eq(tables.scheduledActions.status, ScheduledActionStatuses.PENDING),
            and(
              eq(tables.scheduledActions.status, ScheduledActionStatuses.DISPATCHING),
              eq(tables.scheduledActions.dispatchClaimKey, input.dispatchClaimKey),
            ),
            and(
              eq(tables.scheduledActions.status, ScheduledActionStatuses.DISPATCHING),
              or(
                isNull(tables.scheduledActions.dispatchingAt),
                lt(
                  tables.scheduledActions.dispatchingAt,
                  input.staleDispatchingBefore.toISOString(),
                ),
              ),
            ),
          ),
        ),
      )
      .limit(1)
      .for("update");

    const candidate = candidateRows[0];
    if (candidate === undefined) {
      return resolveUnclaimedScheduledAction(tx, {
        scheduledActionId: input.scheduledActionId,
      });
    }

    const updatedRows = await tx
      .update(tables.scheduledActions)
      .set({
        status: ScheduledActionStatuses.DISPATCHING,
        dispatchingAt: sql`now()`,
        dispatchClaimKey: input.dispatchClaimKey,
      })
      .where(eq(tables.scheduledActions.id, input.scheduledActionId))
      .returning({
        id: tables.scheduledActions.id,
      });

    if (updatedRows.length !== 1) {
      throw new Error(
        `Expected to claim scheduled action ${input.scheduledActionId}, updated ${String(updatedRows.length)} rows.`,
      );
    }

    return {
      status: "claimed",
      scheduledActionId: candidate.id,
      organizationId: candidate.organizationId,
      scheduleId: candidate.scheduleId,
      targetType: candidate.targetType,
      targetPayload: candidate.targetPayload,
      previousStatus: candidate.previousStatus,
      previousDispatchClaimKey: candidate.previousDispatchClaimKey,
      previousDispatchingAt: candidate.previousDispatchingAt,
      targetWorkflowId: candidate.targetWorkflowId,
      targetWorkflowStartedAt: candidate.targetWorkflowStartedAt,
    };
  });
}

async function resolveUnclaimedScheduledAction(
  tx: ControlPlaneTransaction,
  input: {
    scheduledActionId: string;
  },
): Promise<ScheduledActionDispatchClaimResult> {
  const scheduledAction = await tx.query.scheduledActions.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.scheduledActionId),
  });

  if (scheduledAction === undefined) {
    return {
      status: "missing",
      scheduledActionId: input.scheduledActionId,
    };
  }

  if (scheduledAction.status === ScheduledActionStatuses.DISPATCHING) {
    return {
      status: "actively-dispatching",
      scheduledActionId: input.scheduledActionId,
    };
  }

  return {
    status: "already-finalized",
    scheduledActionId: input.scheduledActionId,
    scheduledActionStatus: scheduledAction.status,
  };
}
