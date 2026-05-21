import {
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  ScheduledActionStatuses,
  ScheduleKinds,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { and, eq, sql } from "drizzle-orm";
import type { OpenWorkflow } from "openworkflow";

import { ScheduleActionFailureCodes, TriggerSchedulesBadRequestCodes } from "../constants.js";
import {
  type TriggerScheduleAggregate,
  loadScheduleTriggerAggregateOrThrow,
} from "./load-schedule-trigger-aggregate-or-throw.js";
import {
  cancelPendingOneOffScheduleWorkflow,
  enqueueOneOffScheduleWorkflow,
} from "./one-off-schedule-workflow.js";
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
        kind?: "recurring" | undefined;
        name?: string | undefined;
        cronExpression?: string | undefined;
        timezone?: string | undefined;
      }
    | {
        kind: "one_off";
        name?: string | undefined;
        startAt?: string | undefined;
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
  ctx: {
    db: ControlPlaneDatabase;
    openWorkflow: Pick<OpenWorkflow, "cancelWorkflowRun" | "runWorkflow">;
  },
  input: UpdateScheduleTriggerInput,
) {
  const existingTrigger = await loadScheduleTriggerAggregateOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      triggerId: input.triggerId,
    },
  );
  assertScheduleUpdateKindMatches(existingTrigger, input);

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

  const oneOffWorkflowChange = resolveOneOffWorkflowChange(input, existingTrigger);

  const updatedTrigger = await ctx.db.transaction(async (tx) => {
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

    return await loadScheduleTriggerAggregateOrThrow(
      { db: tx },
      {
        organizationId: input.organizationId,
        triggerId: input.triggerId,
      },
    );
  });

  if (oneOffWorkflowChange.cancelExisting) {
    await cancelPendingOneOffScheduleWorkflow(
      {
        openWorkflow: ctx.openWorkflow,
      },
      {
        scheduleId: existingTrigger.schedule.id,
        workflowRunId: existingTrigger.schedule.oneOffWorkflowRunId,
        wasPendingExecution: isPendingOneOffExecution(existingTrigger),
      },
    );
  }

  if (
    updatedTrigger.schedule.kind === ScheduleKinds.ONE_OFF &&
    updatedTrigger.schedule.enabled &&
    updatedTrigger.schedule.nextScheduledAt !== null &&
    oneOffWorkflowChange.enqueueNext
  ) {
    await enqueueOneOffScheduleWorkflow(
      {
        db: ctx.db,
        openWorkflow: ctx.openWorkflow,
      },
      {
        scheduleId: updatedTrigger.schedule.id,
        availableAt: new Date(updatedTrigger.schedule.nextScheduledAt),
      },
    );

    return await loadScheduleTriggerAggregateOrThrow(
      { db: ctx.db },
      {
        organizationId: input.organizationId,
        triggerId: input.triggerId,
      },
    );
  }

  return updatedTrigger;
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
  const nextScheduleTiming = resolveUpdateScheduleTiming(input, existingTrigger, nextEnabled);
  const scheduleTimingChanged = didScheduleTimingChange(input);
  const enabledChanged = input.enabled !== undefined && input.enabled !== existingTrigger.enabled;
  const recomputedNextScheduledAt = scheduleTimingChanged || enabledChanged;
  const tables = getControlPlaneDatabaseSchema(tx);
  const nextValues: Partial<typeof tables.schedules.$inferInsert> = {};

  if (input.schedule?.name !== undefined) {
    nextValues.name = input.schedule.name;
  }

  if (
    input.schedule !== undefined &&
    input.schedule.kind !== "one_off" &&
    input.schedule.cronExpression !== undefined
  ) {
    nextValues.cronExpression = input.schedule.cronExpression;
  }

  if (
    input.schedule !== undefined &&
    input.schedule.kind !== "one_off" &&
    input.schedule.timezone !== undefined
  ) {
    nextValues.timezone = input.schedule.timezone;
  }

  if (
    input.schedule !== undefined &&
    input.schedule.kind === "one_off" &&
    input.schedule.startAt !== undefined
  ) {
    nextValues.startAt = nextScheduleTiming.startAt;
  }

  if (input.enabled !== undefined) {
    nextValues.enabled = input.enabled;
  }

  if (!nextEnabled) {
    nextValues.nextScheduledAt = null;
  } else if (recomputedNextScheduledAt) {
    nextValues.nextScheduledAt = nextScheduleTiming.nextScheduledAt;
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

function assertScheduleUpdateKindMatches(
  existingTrigger: TriggerScheduleAggregate,
  input: UpdateScheduleTriggerInput,
): void {
  if (input.schedule === undefined) {
    return;
  }

  const requestedKind = input.schedule.kind ?? ScheduleKinds.RECURRING;
  if (requestedKind === existingTrigger.schedule.kind) {
    return;
  }

  throw new BadRequestError(
    TriggerSchedulesBadRequestCodes.INVALID_SCHEDULE,
    "Schedule kind cannot be changed.",
  );
}

function resolveUpdateScheduleTiming(
  input: UpdateScheduleTriggerInput,
  existingTrigger: TriggerScheduleAggregate,
  nextEnabled: boolean,
): {
  nextScheduledAt: string | null;
  startAt: string | null;
} {
  if (existingTrigger.schedule.kind === ScheduleKinds.ONE_OFF) {
    const startAt =
      input.schedule?.kind === "one_off" && input.schedule.startAt !== undefined
        ? resolveStartAtOrThrow(input.schedule.startAt).toISOString()
        : existingTrigger.schedule.startAt;
    if (startAt === null) {
      throw new Error(`One-off schedule '${existingTrigger.schedule.id}' is missing start_at.`);
    }

    return {
      nextScheduledAt: nextEnabled ? startAt : null,
      startAt,
    };
  }

  const nextCronExpression =
    input.schedule !== undefined &&
    input.schedule.kind !== "one_off" &&
    input.schedule.cronExpression !== undefined
      ? input.schedule.cronExpression
      : existingTrigger.schedule.cronExpression;
  const nextTimezone =
    input.schedule !== undefined &&
    input.schedule.kind !== "one_off" &&
    input.schedule.timezone !== undefined
      ? input.schedule.timezone
      : existingTrigger.schedule.timezone;
  if (nextCronExpression === null) {
    throw new Error(
      `Recurring schedule '${existingTrigger.schedule.id}' is missing cron_expression.`,
    );
  }
  if (nextTimezone === null) {
    throw new Error(`Recurring schedule '${existingTrigger.schedule.id}' is missing timezone.`);
  }

  return {
    nextScheduledAt: nextEnabled
      ? resolveNextScheduledAtOrThrow({
          cronExpression: nextCronExpression,
          timezone: nextTimezone,
          now: input.now,
        })
      : null,
    startAt: null,
  };
}

function didScheduleTimingChange(input: UpdateScheduleTriggerInput): boolean {
  if (input.schedule === undefined) {
    return false;
  }

  if (input.schedule.kind === "one_off") {
    return input.schedule.startAt !== undefined;
  }

  return input.schedule.cronExpression !== undefined || input.schedule.timezone !== undefined;
}

function resolveOneOffWorkflowChange(
  input: UpdateScheduleTriggerInput,
  existingTrigger: TriggerScheduleAggregate,
): {
  cancelExisting: boolean;
  enqueueNext: boolean;
} {
  if (existingTrigger.schedule.kind !== ScheduleKinds.ONE_OFF) {
    return {
      cancelExisting: false,
      enqueueNext: false,
    };
  }

  const timingChanged = didScheduleTimingChange(input);
  const disableRequested = input.enabled === false;
  const enableRequested = input.enabled === true && !existingTrigger.schedule.enabled;

  return {
    cancelExisting:
      isPendingOneOffExecution(existingTrigger) && (timingChanged || disableRequested),
    enqueueNext: timingChanged || enableRequested,
  };
}

function isPendingOneOffExecution(existingTrigger: TriggerScheduleAggregate): boolean {
  return (
    existingTrigger.schedule.kind === ScheduleKinds.ONE_OFF &&
    existingTrigger.schedule.enabled &&
    existingTrigger.schedule.nextScheduledAt !== null
  );
}

function resolveStartAtOrThrow(value: string): Date {
  const startAt = new Date(value);
  if (Number.isNaN(startAt.getTime())) {
    throw new BadRequestError(
      TriggerSchedulesBadRequestCodes.INVALID_SCHEDULE,
      `Invalid one-off schedule startAt '${value}'.`,
    );
  }

  return startAt;
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
