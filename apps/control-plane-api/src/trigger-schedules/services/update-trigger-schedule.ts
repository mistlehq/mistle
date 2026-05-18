import {
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  ScheduledActionStatuses,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import { ScheduleActionFailureCodes } from "../constants.js";
import {
  type TriggerScheduleAggregate,
  loadScheduleTriggerAggregateOrThrow,
} from "./load-schedule-trigger-aggregate-or-throw.js";
import {
  assertPrimaryRepositoryReferenceOrThrow,
  resolveNextScheduledAtOrThrow,
  resolveSandboxProfileVersionOrThrow,
} from "./validation.js";

export type UpdateScheduleTriggerInput = {
  organizationId: string;
  triggerId: string;
  name?: string | undefined;
  enabled?: boolean | undefined;
  schedule?:
    | {
        name?: string | undefined;
        cronExpression?: string | undefined;
        timezone?: string | undefined;
      }
    | undefined;
  inputTemplate?: string | undefined;
  conversationKeyTemplate?: string | undefined;
  idempotencyKeyTemplate?: string | null | undefined;
  target?:
    | {
        sandboxProfileId?: string | undefined;
        sandboxProfileVersion?: number | undefined;
        primaryRepositoryId?: string | null | undefined;
      }
    | undefined;
  now: Date;
};

export async function updateTriggerSchedule(
  ctx: { db: ControlPlaneDatabase },
  input: UpdateScheduleTriggerInput,
) {
  const existingTrigger = await loadScheduleTriggerAggregateOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      triggerId: input.triggerId,
    },
  );

  const sandboxProfileId =
    input.target?.sandboxProfileId ?? existingTrigger.target.sandboxProfileId;
  const sandboxProfileChanged =
    input.target?.sandboxProfileId !== undefined &&
    input.target.sandboxProfileId !== existingTrigger.target.sandboxProfileId;
  const requestedSandboxProfileVersion =
    input.target?.sandboxProfileVersion !== undefined
      ? input.target.sandboxProfileVersion
      : sandboxProfileChanged
        ? undefined
        : existingTrigger.target.sandboxProfileVersion;
  const primaryRepositoryId =
    input.target?.primaryRepositoryId === undefined
      ? existingTrigger.target.primaryRepositoryId
      : input.target.primaryRepositoryId;

  const resolvedSandboxProfileVersion = await resolveSandboxProfileVersionOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      sandboxProfileId,
      sandboxProfileVersion: requestedSandboxProfileVersion,
    },
  );
  await assertPrimaryRepositoryReferenceOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      sandboxProfileId,
      sandboxProfileVersion: resolvedSandboxProfileVersion,
      primaryRepositoryId,
    },
  );

  return ctx.db.transaction(async (tx) => {
    await updateTriggerBaseRow(tx, input);
    await updateScheduleRow(tx, input, existingTrigger);
    await updateScheduleTriggerConfigRow(tx, input);
    await updateTriggerTargetRow(
      tx,
      existingTrigger.target.id,
      input.target === undefined
        ? undefined
        : {
            sandboxProfileId,
            sandboxProfileVersion: resolvedSandboxProfileVersion,
            primaryRepositoryId,
          },
    );

    if (input.enabled === false) {
      await failPendingScheduledActions(tx, {
        scheduleId: existingTrigger.schedule.id,
        failureCode: ScheduleActionFailureCodes.SCHEDULE_DISABLED,
        failureMessage: "Schedule was disabled before the action was dispatched.",
      });
    }

    return loadScheduleTriggerAggregateOrThrow(
      { db: tx },
      {
        organizationId: input.organizationId,
        triggerId: input.triggerId,
      },
    );
  });
}

async function updateTriggerBaseRow(
  tx: ControlPlaneTransaction,
  input: UpdateScheduleTriggerInput,
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(tx);
  const nextValues: Partial<typeof tables.triggers.$inferInsert> = {};

  if (input.name !== undefined) {
    nextValues.name = input.name;
  }

  if (input.enabled !== undefined) {
    nextValues.enabled = input.enabled;
  }

  await tx
    .update(tables.triggers)
    .set({
      ...nextValues,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.triggers.id, input.triggerId));
}

async function updateScheduleRow(
  tx: ControlPlaneTransaction,
  input: UpdateScheduleTriggerInput,
  existingTrigger: TriggerScheduleAggregate,
): Promise<void> {
  const nextEnabled = input.enabled ?? existingTrigger.enabled;
  const nextCronExpression =
    input.schedule?.cronExpression ?? existingTrigger.schedule.cronExpression;
  const nextTimezone = input.schedule?.timezone ?? existingTrigger.schedule.timezone;
  const scheduleTimingChanged =
    input.schedule?.cronExpression !== undefined || input.schedule?.timezone !== undefined;
  const enabledChanged = input.enabled !== undefined && input.enabled !== existingTrigger.enabled;
  const recomputedNextScheduledAt =
    scheduleTimingChanged || (nextEnabled && enabledChanged)
      ? resolveNextScheduledAtOrThrow({
          cronExpression: nextCronExpression,
          timezone: nextTimezone,
          now: input.now,
        })
      : undefined;
  const tables = getControlPlaneDatabaseSchema(tx);
  const nextValues: Partial<typeof tables.schedules.$inferInsert> = {};

  if (input.schedule?.name !== undefined) {
    nextValues.name = input.schedule.name;
  }

  if (input.schedule?.cronExpression !== undefined) {
    nextValues.cronExpression = input.schedule.cronExpression;
  }

  if (input.schedule?.timezone !== undefined) {
    nextValues.timezone = input.schedule.timezone;
  }

  if (input.enabled !== undefined) {
    nextValues.enabled = input.enabled;
  }

  if (!nextEnabled) {
    nextValues.nextScheduledAt = null;
  } else if (recomputedNextScheduledAt !== undefined) {
    nextValues.nextScheduledAt = recomputedNextScheduledAt;
  }

  if (Object.keys(nextValues).length === 0) {
    return;
  }

  await tx
    .update(tables.schedules)
    .set({
      ...nextValues,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.schedules.id, existingTrigger.schedule.id));
}

async function updateScheduleTriggerConfigRow(
  tx: ControlPlaneTransaction,
  input: UpdateScheduleTriggerInput,
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(tx);
  const nextValues: Partial<typeof tables.scheduleTriggers.$inferInsert> = {};

  if (input.inputTemplate !== undefined) {
    nextValues.inputTemplate = input.inputTemplate;
  }

  if (input.conversationKeyTemplate !== undefined) {
    nextValues.conversationKeyTemplate = input.conversationKeyTemplate;
  }

  if (input.idempotencyKeyTemplate !== undefined) {
    nextValues.idempotencyKeyTemplate = input.idempotencyKeyTemplate;
  }

  if (Object.keys(nextValues).length === 0) {
    return;
  }

  await tx
    .update(tables.scheduleTriggers)
    .set({
      ...nextValues,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.scheduleTriggers.triggerId, input.triggerId));
}

async function updateTriggerTargetRow(
  tx: ControlPlaneTransaction,
  triggerTargetId: string,
  nextTarget:
    | {
        sandboxProfileId: string;
        sandboxProfileVersion: number;
        primaryRepositoryId: string | null;
      }
    | undefined,
): Promise<void> {
  if (nextTarget === undefined) {
    return;
  }

  const tables = getControlPlaneDatabaseSchema(tx);
  await tx
    .update(tables.triggerTargets)
    .set({
      sandboxProfileId: nextTarget.sandboxProfileId,
      sandboxProfileVersion: nextTarget.sandboxProfileVersion,
      primaryRepositoryId: nextTarget.primaryRepositoryId,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.triggerTargets.id, triggerTargetId));
}

export async function failPendingScheduledActions(
  tx: ControlPlaneTransaction,
  input: {
    scheduleId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(tx);
  await tx
    .update(tables.scheduledActions)
    .set({
      status: ScheduledActionStatuses.FAILED,
      failedAt: sql`now()`,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
    })
    .where(
      and(
        eq(tables.scheduledActions.scheduleId, input.scheduleId),
        eq(tables.scheduledActions.status, ScheduledActionStatuses.PENDING),
      ),
    );
}
