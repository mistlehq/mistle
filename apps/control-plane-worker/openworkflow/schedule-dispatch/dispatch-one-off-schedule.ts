import {
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  ScheduledActionStatuses,
  ScheduleKinds,
  type ScheduleTargetType,
  ScheduleTargetTypes,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { getScheduledLocalSlot } from "@mistle/time";
import { and, eq, sql } from "drizzle-orm";

const OneOffScheduledActionTimezone = "UTC";

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

type OneOffScheduleRow = Readonly<{
  id: string;
  organizationId: string;
  targetType: ScheduleTargetType;
  kind: string;
  enabled: boolean;
  nextScheduledAt: string | null;
  deletedAt: string | null;
}>;

export type CreateOneOffScheduledActionResult =
  | Readonly<{
      status: "created";
      scheduleId: string;
      scheduledActionId: string;
      scheduledAt: string;
    }>
  | Readonly<{
      status: "failed";
      scheduleId: string;
      scheduledActionId: string | null;
      scheduledAt: string;
      failureCode: string;
    }>
  | Readonly<{
      status: "skipped";
      scheduleId: string;
      scheduledActionId: null;
      reason: "schedule_not_found" | "schedule_disabled" | "schedule_deleted";
    }>;

export async function createOneOffScheduledAction(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    scheduleId: string;
  },
): Promise<CreateOneOffScheduledActionResult> {
  return ctx.db.transaction(async (tx) => {
    const schedule = await loadOneOffScheduleForUpdate(tx, input.scheduleId);
    if (schedule === undefined) {
      return {
        status: "skipped",
        scheduleId: input.scheduleId,
        scheduledActionId: null,
        reason: "schedule_not_found",
      };
    }
    if (schedule.kind !== ScheduleKinds.ONE_OFF) {
      throw new Error(`Schedule '${input.scheduleId}' is not a one-off schedule.`);
    }
    if (schedule.nextScheduledAt === null) {
      throw new Error(`One-off schedule '${input.scheduleId}' is missing next_scheduled_at.`);
    }
    if (!schedule.enabled) {
      return {
        status: "skipped",
        scheduleId: input.scheduleId,
        scheduledActionId: null,
        reason: "schedule_disabled",
      };
    }
    if (schedule.deletedAt !== null) {
      return {
        status: "skipped",
        scheduleId: input.scheduleId,
        scheduledActionId: null,
        reason: "schedule_deleted",
      };
    }

    const scheduledAt = new Date(schedule.nextScheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new Error(
        `One-off schedule '${input.scheduleId}' has invalid next_scheduled_at '${schedule.nextScheduledAt}'.`,
      );
    }

    const targetPayload = await resolveTargetPayload(tx, {
      scheduleId: schedule.id,
      targetType: schedule.targetType,
    });
    if (!targetPayload.resolved) {
      const failedScheduledActionId = await insertFailedScheduledAction(tx, {
        failureCode: targetPayload.failureCode,
        failureMessage: targetPayload.failureMessage,
        organizationId: schedule.organizationId,
        scheduleId: schedule.id,
        scheduledAt,
        targetPayload: targetPayload.payload,
        targetType: schedule.targetType,
      });
      await finalizeOneOffSchedule(tx, {
        scheduleId: schedule.id,
        scheduledAt,
      });
      return {
        status: "failed",
        scheduleId: schedule.id,
        scheduledActionId: failedScheduledActionId,
        scheduledAt: scheduledAt.toISOString(),
        failureCode: targetPayload.failureCode,
      };
    }

    const scheduledActionId = await insertOrReadPendingScheduledAction(tx, {
      organizationId: schedule.organizationId,
      scheduleId: schedule.id,
      scheduledAt,
      targetPayload: targetPayload.payload,
      targetType: schedule.targetType,
    });

    return {
      status: "created",
      scheduleId: schedule.id,
      scheduledActionId,
      scheduledAt: scheduledAt.toISOString(),
    };
  });
}

export async function finalizeDispatchedOneOffSchedule(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    scheduleId: string;
    scheduledAt: string;
  },
): Promise<void> {
  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error(
      `One-off schedule '${input.scheduleId}' has invalid scheduled action timestamp '${input.scheduledAt}'.`,
    );
  }

  await ctx.db.transaction(async (tx) => {
    await finalizeOneOffSchedule(tx, {
      scheduleId: input.scheduleId,
      scheduledAt,
    });
  });
}

async function loadOneOffScheduleForUpdate(
  tx: ControlPlaneTransaction,
  scheduleId: string,
): Promise<OneOffScheduleRow | undefined> {
  const tables = getControlPlaneDatabaseSchema(tx);
  const rows = await tx
    .select({
      id: tables.schedules.id,
      organizationId: tables.schedules.organizationId,
      targetType: tables.schedules.targetType,
      kind: tables.schedules.kind,
      enabled: tables.schedules.enabled,
      nextScheduledAt: tables.schedules.nextScheduledAt,
      deletedAt: tables.schedules.deletedAt,
    })
    .from(tables.schedules)
    .where(eq(tables.schedules.id, scheduleId))
    .for("update");

  return rows[0];
}

async function resolveTargetPayload(
  tx: ControlPlaneTransaction,
  input: {
    scheduleId: string;
    targetType: string;
  },
): Promise<TargetPayloadResult> {
  if (input.targetType === ScheduleTargetTypes.TRIGGER_RUN) {
    const target = await tx.query.scheduleTriggers.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.scheduleId, input.scheduleId),
    });
    if (target === undefined) {
      return createMissingTargetPayload(input);
    }

    return {
      resolved: true,
      payload: {
        triggerId: target.triggerId,
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

async function insertOrReadPendingScheduledAction(
  tx: ControlPlaneTransaction,
  input: {
    organizationId: string;
    scheduleId: string;
    scheduledAt: Date;
    targetPayload: Record<string, unknown>;
    targetType: ScheduleTargetType;
  },
): Promise<string> {
  const tables = getControlPlaneDatabaseSchema(tx);
  const scheduledAt = input.scheduledAt.toISOString();
  const localSlot = getScheduledLocalSlot({
    scheduledAt: input.scheduledAt,
    timezone: OneOffScheduledActionTimezone,
  });
  const insertedRows = await tx
    .insert(tables.scheduledActions)
    .values({
      scheduleId: input.scheduleId,
      organizationId: input.organizationId,
      targetType: input.targetType,
      targetPayload: input.targetPayload,
      scheduledAt,
      localScheduledDate: localSlot.localScheduledDate,
      localScheduledTime: localSlot.localScheduledTime,
    })
    .onConflictDoNothing()
    .returning({
      id: tables.scheduledActions.id,
    });

  const insertedId = insertedRows[0]?.id;
  if (insertedId !== undefined) {
    return insertedId;
  }

  const existing = await tx.query.scheduledActions.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.scheduleId, input.scheduleId),
        whereEq(table.scheduledAt, scheduledAt),
      ),
  });
  if (existing === undefined) {
    throw new Error(
      `Expected one-off scheduled action for schedule '${input.scheduleId}' at '${scheduledAt}'.`,
    );
  }

  return existing.id;
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
  },
): Promise<string | null> {
  const tables = getControlPlaneDatabaseSchema(tx);
  const localSlot = getScheduledLocalSlot({
    scheduledAt: input.scheduledAt,
    timezone: OneOffScheduledActionTimezone,
  });
  const insertedRows = await tx
    .insert(tables.scheduledActions)
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
      id: tables.scheduledActions.id,
    });

  return insertedRows[0]?.id ?? null;
}

async function finalizeOneOffSchedule(
  tx: ControlPlaneTransaction,
  input: {
    scheduleId: string;
    scheduledAt: Date;
  },
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(tx);
  const updatedRows = await tx
    .update(tables.schedules)
    .set({
      enabled: false,
      lastScheduledAt: input.scheduledAt.toISOString(),
      nextScheduledAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.schedules.id, input.scheduleId),
        eq(tables.schedules.kind, ScheduleKinds.ONE_OFF),
      ),
    )
    .returning({
      id: tables.schedules.id,
    });

  if (updatedRows.length !== 1) {
    throw new Error(`Expected to finalize one-off schedule '${input.scheduleId}'.`);
  }
}
