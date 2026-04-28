import {
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  scheduledActions,
  ScheduledActionStatuses,
  schedules,
  type ScheduleTargetType,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import { findNextScheduleOccurrence, getScheduledLocalSlot } from "@mistle/time";
import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";

const CatchUpWindowMs = 24 * 60 * 60 * 1000;
const ClaimBatchSize = 500;
const MaxBatchesPerDispatch = 100;

type ClaimedScheduleRow = {
  id: string;
  organizationId: string;
  targetType: ScheduleTargetType;
  cronExpression: string;
  timezone: string;
  nextScheduledAt: string;
  endAt: string | null;
};

type TargetPayloadResult =
  | Readonly<{
      resolved: true;
      payload: Record<string, unknown>;
    }>
  | Readonly<{
      resolved: false;
      payload: Record<string, unknown>;
      failureCode: string;
      failureMessage: string;
    }>;

type DispatchableAction = Readonly<{
  id: string;
  status: typeof ScheduledActionStatuses.PENDING;
}>;

type NonDispatchableAction = Readonly<{
  id: string | null;
  status: typeof ScheduledActionStatuses.FAILED | typeof ScheduledActionStatuses.SKIPPED_LATE;
}>;

type CreatedScheduledAction = DispatchableAction | NonDispatchableAction;

type ClaimedScheduleResult = Readonly<{
  pendingScheduledActionIds: string[];
  claimedScheduleCount: number;
}>;

export type DispatchDueSchedulesResult = Readonly<{
  pendingScheduledActionIds: string[];
  claimedScheduleCount: number;
  reachedMaxBatches: boolean;
}>;

export async function dispatchDueSchedules(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    cutoffMinute: Date;
  },
): Promise<DispatchDueSchedulesResult> {
  const pendingScheduledActionIds: string[] = [];
  let claimedScheduleCount = 0;
  let batchCount = 0;

  while (batchCount < MaxBatchesPerDispatch) {
    const batch = await claimDueScheduleBatch(ctx, {
      cutoffMinute: input.cutoffMinute,
    });
    if (batch.claimedScheduleCount === 0) {
      return {
        pendingScheduledActionIds,
        claimedScheduleCount,
        reachedMaxBatches: false,
      };
    }

    pendingScheduledActionIds.push(...batch.pendingScheduledActionIds);
    claimedScheduleCount += batch.claimedScheduleCount;
    batchCount += 1;
  }

  return {
    pendingScheduledActionIds,
    claimedScheduleCount,
    reachedMaxBatches: true,
  };
}

async function claimDueScheduleBatch(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    cutoffMinute: Date;
  },
): Promise<ClaimedScheduleResult> {
  return ctx.db.transaction(async (tx) => {
    const claimedSchedules = await claimDueScheduleRows(tx, {
      cutoffMinute: input.cutoffMinute,
    });
    const pendingScheduledActionIds: string[] = [];

    for (const claimedSchedule of claimedSchedules) {
      const scheduledAction = await consumeClaimedSchedule(tx, {
        cutoffMinute: input.cutoffMinute,
        schedule: claimedSchedule,
      });
      if (scheduledAction.status === ScheduledActionStatuses.PENDING) {
        pendingScheduledActionIds.push(scheduledAction.id);
      }
    }

    return {
      pendingScheduledActionIds,
      claimedScheduleCount: claimedSchedules.length,
    };
  });
}

async function claimDueScheduleRows(
  tx: ControlPlaneTransaction,
  input: {
    cutoffMinute: Date;
  },
): Promise<ClaimedScheduleRow[]> {
  const rows = await tx
    .select({
      id: schedules.id,
      organizationId: schedules.organizationId,
      targetType: schedules.targetType,
      cronExpression: schedules.cronExpression,
      timezone: schedules.timezone,
      nextScheduledAt: schedules.nextScheduledAt,
      endAt: schedules.endAt,
    })
    .from(schedules)
    .where(
      and(
        eq(schedules.enabled, true),
        isNull(schedules.deletedAt),
        isNotNull(schedules.nextScheduledAt),
        lte(schedules.nextScheduledAt, input.cutoffMinute.toISOString()),
      ),
    )
    .orderBy(schedules.nextScheduledAt, schedules.id)
    .limit(ClaimBatchSize)
    .for("update", { skipLocked: true });

  return rows.map((row) => {
    if (row.nextScheduledAt === null) {
      throw new Error(`Claimed schedule ${row.id} is missing next_scheduled_at.`);
    }

    return {
      id: row.id,
      organizationId: row.organizationId,
      targetType: row.targetType,
      cronExpression: row.cronExpression,
      timezone: row.timezone,
      nextScheduledAt: row.nextScheduledAt,
      endAt: row.endAt,
    };
  });
}

async function consumeClaimedSchedule(
  tx: ControlPlaneTransaction,
  input: {
    cutoffMinute: Date;
    schedule: ClaimedScheduleRow;
  },
): Promise<CreatedScheduledAction> {
  const scheduledAt = new Date(input.schedule.nextScheduledAt);
  const targetPayload = await resolveTargetPayload(tx, {
    scheduleId: input.schedule.id,
    targetType: input.schedule.targetType,
  });

  if (!targetPayload.resolved) {
    const failedAction = await insertFailedScheduledAction(tx, {
      failureCode: targetPayload.failureCode,
      failureMessage: targetPayload.failureMessage,
      organizationId: input.schedule.organizationId,
      scheduleId: input.schedule.id,
      scheduledAt,
      targetPayload: targetPayload.payload,
      targetType: input.schedule.targetType,
      timezone: input.schedule.timezone,
    });
    await softDeleteScheduleWithMissingTarget(tx, {
      scheduleId: input.schedule.id,
      scheduledAt,
    });
    return {
      id: failedAction,
      status: ScheduledActionStatuses.FAILED,
    };
  }

  if (input.cutoffMinute.getTime() - scheduledAt.getTime() > CatchUpWindowMs) {
    return skipLateScheduleBacklog(tx, {
      cutoffMinute: input.cutoffMinute,
      payload: targetPayload.payload,
      schedule: input.schedule,
      scheduledAt,
    });
  }

  const pendingActionId = await insertPendingScheduledAction(tx, {
    organizationId: input.schedule.organizationId,
    scheduleId: input.schedule.id,
    scheduledAt,
    targetPayload: targetPayload.payload,
    targetType: input.schedule.targetType,
    timezone: input.schedule.timezone,
  });
  await advanceScheduleCursor(tx, {
    consumedScheduledAt: scheduledAt,
    cronExpression: input.schedule.cronExpression,
    endAt: input.schedule.endAt === null ? null : new Date(input.schedule.endAt),
    scheduleId: input.schedule.id,
    timezone: input.schedule.timezone,
  });

  if (pendingActionId === null) {
    return {
      id: null,
      status: ScheduledActionStatuses.SKIPPED_LATE,
    };
  }

  return {
    id: pendingActionId,
    status: ScheduledActionStatuses.PENDING,
  };
}

async function resolveTargetPayload(
  tx: ControlPlaneTransaction,
  input: {
    scheduleId: string;
    targetType: string;
  },
): Promise<TargetPayloadResult> {
  if (input.targetType === ScheduleTargetTypes.AUTOMATION_RUN) {
    const target = await tx.query.scheduleAutomations.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.scheduleId, input.scheduleId),
    });
    if (target === undefined) {
      return createMissingTargetPayload(input);
    }

    return {
      resolved: true,
      payload: {
        automationId: target.automationId,
      },
    };
  }

  if (input.targetType === ScheduleTargetTypes.SNAPSHOT_REFRESH) {
    const target = await tx.query.sandboxProfileSnapshotRefreshScheduleTargets.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.scheduleId, input.scheduleId),
    });
    if (target === undefined) {
      return createMissingTargetPayload(input);
    }

    return {
      resolved: true,
      payload: {
        sandboxProfileId: target.sandboxProfileId,
        sandboxProfileVersion: target.sandboxProfileVersion,
      },
    };
  }

  return {
    resolved: false,
    payload: {
      scheduleId: input.scheduleId,
      targetType: input.targetType,
    },
    failureCode: "unsupported_target_type",
    failureMessage: `Unsupported schedule target type: ${input.targetType}`,
  };
}

function createMissingTargetPayload(input: {
  scheduleId: string;
  targetType: string;
}): TargetPayloadResult {
  return {
    resolved: false,
    payload: {
      scheduleId: input.scheduleId,
      targetType: input.targetType,
    },
    failureCode: "target_missing",
    failureMessage: "Schedule target row is missing.",
  };
}

async function skipLateScheduleBacklog(
  tx: ControlPlaneTransaction,
  input: {
    cutoffMinute: Date;
    payload: Record<string, unknown>;
    schedule: ClaimedScheduleRow;
    scheduledAt: Date;
  },
): Promise<CreatedScheduledAction> {
  const skippedRange = resolveSkippedLateRange({
    cutoffMinute: input.cutoffMinute,
    schedule: input.schedule,
    scheduledAt: input.scheduledAt,
  });
  const skippedActionId = await insertSkippedLateScheduledAction(tx, {
    organizationId: input.schedule.organizationId,
    scheduleId: input.schedule.id,
    scheduledAt: input.scheduledAt,
    skippedUntilScheduledAt: skippedRange.skippedUntilScheduledAt,
    targetPayload: input.payload,
    targetType: input.schedule.targetType,
    timezone: input.schedule.timezone,
  });

  await updateScheduleCursor(tx, {
    enabled: skippedRange.nextScheduledAt !== null,
    lastScheduledAt: skippedRange.skippedUntilScheduledAt,
    nextScheduledAt: skippedRange.nextScheduledAt,
    scheduleId: input.schedule.id,
  });

  return {
    id: skippedActionId,
    status: ScheduledActionStatuses.SKIPPED_LATE,
  };
}

function resolveSkippedLateRange(input: {
  cutoffMinute: Date;
  schedule: ClaimedScheduleRow;
  scheduledAt: Date;
}): {
  skippedUntilScheduledAt: Date;
  nextScheduledAt: Date | null;
} {
  const catchUpThreshold = new Date(input.cutoffMinute.getTime() - CatchUpWindowMs);
  const endAt = input.schedule.endAt === null ? null : new Date(input.schedule.endAt);
  let skippedUntilScheduledAt = input.scheduledAt;
  let nextOccurrence = findNextScheduleOccurrence({
    after: skippedUntilScheduledAt,
    cronExpression: input.schedule.cronExpression,
    endAt,
    timezone: input.schedule.timezone,
  });

  while (
    nextOccurrence !== null &&
    nextOccurrence.scheduledAt.getTime() < catchUpThreshold.getTime()
  ) {
    skippedUntilScheduledAt = nextOccurrence.scheduledAt;
    nextOccurrence = findNextScheduleOccurrence({
      after: skippedUntilScheduledAt,
      cronExpression: input.schedule.cronExpression,
      endAt,
      timezone: input.schedule.timezone,
    });
  }

  return {
    skippedUntilScheduledAt,
    nextScheduledAt: nextOccurrence?.scheduledAt ?? null,
  };
}

async function insertPendingScheduledAction(
  tx: ControlPlaneTransaction,
  input: {
    organizationId: string;
    scheduleId: string;
    scheduledAt: Date;
    targetPayload: Record<string, unknown>;
    targetType: ScheduleTargetType;
    timezone: string;
  },
): Promise<string | null> {
  const localSlot = getScheduledLocalSlot({
    scheduledAt: input.scheduledAt,
    timezone: input.timezone,
  });
  const insertedRows = await tx
    .insert(scheduledActions)
    .values({
      scheduleId: input.scheduleId,
      organizationId: input.organizationId,
      targetType: input.targetType,
      targetPayload: input.targetPayload,
      scheduledAt: input.scheduledAt.toISOString(),
      localScheduledDate: localSlot.localScheduledDate,
      localScheduledTime: localSlot.localScheduledTime,
    })
    .onConflictDoNothing()
    .returning({
      id: scheduledActions.id,
    });

  return insertedRows[0]?.id ?? null;
}

async function insertSkippedLateScheduledAction(
  tx: ControlPlaneTransaction,
  input: {
    organizationId: string;
    scheduleId: string;
    scheduledAt: Date;
    skippedUntilScheduledAt: Date;
    targetPayload: Record<string, unknown>;
    targetType: ScheduleTargetType;
    timezone: string;
  },
): Promise<string | null> {
  const localSlot = getScheduledLocalSlot({
    scheduledAt: input.scheduledAt,
    timezone: input.timezone,
  });
  const insertedRows = await tx
    .insert(scheduledActions)
    .values({
      scheduleId: input.scheduleId,
      organizationId: input.organizationId,
      targetType: input.targetType,
      targetPayload: input.targetPayload,
      scheduledAt: input.scheduledAt.toISOString(),
      localScheduledDate: localSlot.localScheduledDate,
      localScheduledTime: localSlot.localScheduledTime,
      status: ScheduledActionStatuses.SKIPPED_LATE,
      skippedAt: sql`now()`,
      skippedFromScheduledAt: input.scheduledAt.toISOString(),
      skippedUntilScheduledAt: input.skippedUntilScheduledAt.toISOString(),
      failureCode: "catch_up_window_exceeded",
      failureMessage: "Scheduled action exceeded the catch-up window.",
    })
    .onConflictDoNothing()
    .returning({
      id: scheduledActions.id,
    });

  return insertedRows[0]?.id ?? null;
}

async function insertFailedScheduledAction(
  tx: ControlPlaneTransaction,
  input: {
    failureCode: string;
    failureMessage: string;
    organizationId: string;
    scheduleId: string;
    scheduledAt: Date;
    targetPayload: Record<string, unknown>;
    targetType: ScheduleTargetType;
    timezone: string;
  },
): Promise<string | null> {
  const localSlot = getScheduledLocalSlot({
    scheduledAt: input.scheduledAt,
    timezone: input.timezone,
  });
  const insertedRows = await tx
    .insert(scheduledActions)
    .values({
      scheduleId: input.scheduleId,
      organizationId: input.organizationId,
      targetType: input.targetType,
      targetPayload: input.targetPayload,
      scheduledAt: input.scheduledAt.toISOString(),
      localScheduledDate: localSlot.localScheduledDate,
      localScheduledTime: localSlot.localScheduledTime,
      status: ScheduledActionStatuses.FAILED,
      failedAt: sql`now()`,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
    })
    .onConflictDoNothing()
    .returning({
      id: scheduledActions.id,
    });

  return insertedRows[0]?.id ?? null;
}

async function advanceScheduleCursor(
  tx: ControlPlaneTransaction,
  input: {
    consumedScheduledAt: Date;
    cronExpression: string;
    endAt: Date | null;
    scheduleId: string;
    timezone: string;
  },
): Promise<void> {
  const nextOccurrence = findNextScheduleOccurrence({
    after: input.consumedScheduledAt,
    cronExpression: input.cronExpression,
    endAt: input.endAt,
    timezone: input.timezone,
  });

  await updateScheduleCursor(tx, {
    enabled: nextOccurrence !== null,
    lastScheduledAt: input.consumedScheduledAt,
    nextScheduledAt: nextOccurrence?.scheduledAt ?? null,
    scheduleId: input.scheduleId,
  });
}

async function updateScheduleCursor(
  tx: ControlPlaneTransaction,
  input: {
    enabled: boolean;
    lastScheduledAt: Date;
    nextScheduledAt: Date | null;
    scheduleId: string;
  },
): Promise<void> {
  const updatedRows = await tx
    .update(schedules)
    .set({
      enabled: input.enabled,
      lastScheduledAt: input.lastScheduledAt.toISOString(),
      nextScheduledAt: input.nextScheduledAt?.toISOString() ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(schedules.id, input.scheduleId))
    .returning({
      id: schedules.id,
    });

  assertSingleScheduleUpdated({
    scheduleId: input.scheduleId,
    updatedRowCount: updatedRows.length,
  });
}

async function softDeleteScheduleWithMissingTarget(
  tx: ControlPlaneTransaction,
  input: {
    scheduleId: string;
    scheduledAt: Date;
  },
): Promise<void> {
  const updatedRows = await tx
    .update(schedules)
    .set({
      enabled: false,
      lastScheduledAt: input.scheduledAt.toISOString(),
      nextScheduledAt: null,
      deletedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(schedules.id, input.scheduleId))
    .returning({
      id: schedules.id,
    });

  assertSingleScheduleUpdated({
    scheduleId: input.scheduleId,
    updatedRowCount: updatedRows.length,
  });
}

function assertSingleScheduleUpdated(input: { scheduleId: string; updatedRowCount: number }): void {
  if (input.updatedRowCount !== 1) {
    throw new Error(
      `Expected to update schedule ${input.scheduleId}, updated ${String(input.updatedRowCount)} rows.`,
    );
  }
}
