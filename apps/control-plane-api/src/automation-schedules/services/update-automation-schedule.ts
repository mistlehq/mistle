import {
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  ScheduledActionStatuses,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import { ScheduleActionFailureCodes } from "../constants.js";
import {
  type AutomationScheduleAggregate,
  loadScheduleAutomationAggregateOrThrow,
} from "./load-schedule-automation-aggregate-or-throw.js";
import {
  assertPrimaryRepositoryReferenceOrThrow,
  resolveNextScheduledAtOrThrow,
  resolveSandboxProfileVersionOrThrow,
} from "./validation.js";

export type UpdateScheduleAutomationInput = {
  organizationId: string;
  automationId: string;
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

export async function updateAutomationSchedule(
  ctx: { db: ControlPlaneDatabase },
  input: UpdateScheduleAutomationInput,
) {
  const existingAutomation = await loadScheduleAutomationAggregateOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      automationId: input.automationId,
    },
  );

  const sandboxProfileId =
    input.target?.sandboxProfileId ?? existingAutomation.target.sandboxProfileId;
  const sandboxProfileChanged =
    input.target?.sandboxProfileId !== undefined &&
    input.target.sandboxProfileId !== existingAutomation.target.sandboxProfileId;
  const requestedSandboxProfileVersion =
    input.target?.sandboxProfileVersion !== undefined
      ? input.target.sandboxProfileVersion
      : sandboxProfileChanged
        ? undefined
        : existingAutomation.target.sandboxProfileVersion;
  const primaryRepositoryId =
    input.target?.primaryRepositoryId === undefined
      ? existingAutomation.target.primaryRepositoryId
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
    await updateAutomationBaseRow(tx, input);
    await updateScheduleRow(tx, input, existingAutomation);
    await updateScheduleAutomationConfigRow(tx, input);
    await updateAutomationTargetRow(
      tx,
      existingAutomation.target.id,
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
        scheduleId: existingAutomation.schedule.id,
        failureCode: ScheduleActionFailureCodes.SCHEDULE_DISABLED,
        failureMessage: "Schedule was disabled before the action was dispatched.",
      });
    }

    return loadScheduleAutomationAggregateOrThrow(
      { db: tx },
      {
        organizationId: input.organizationId,
        automationId: input.automationId,
      },
    );
  });
}

async function updateAutomationBaseRow(
  tx: ControlPlaneTransaction,
  input: UpdateScheduleAutomationInput,
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(tx);
  const nextValues: Partial<typeof tables.automations.$inferInsert> = {};

  if (input.name !== undefined) {
    nextValues.name = input.name;
  }

  if (input.enabled !== undefined) {
    nextValues.enabled = input.enabled;
  }

  await tx
    .update(tables.automations)
    .set({
      ...nextValues,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.automations.id, input.automationId));
}

async function updateScheduleRow(
  tx: ControlPlaneTransaction,
  input: UpdateScheduleAutomationInput,
  existingAutomation: AutomationScheduleAggregate,
): Promise<void> {
  const nextEnabled = input.enabled ?? existingAutomation.enabled;
  const nextCronExpression =
    input.schedule?.cronExpression ?? existingAutomation.schedule.cronExpression;
  const nextTimezone = input.schedule?.timezone ?? existingAutomation.schedule.timezone;
  const scheduleTimingChanged =
    input.schedule?.cronExpression !== undefined || input.schedule?.timezone !== undefined;
  const enabledChanged =
    input.enabled !== undefined && input.enabled !== existingAutomation.enabled;
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
    .where(eq(tables.schedules.id, existingAutomation.schedule.id));
}

async function updateScheduleAutomationConfigRow(
  tx: ControlPlaneTransaction,
  input: UpdateScheduleAutomationInput,
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(tx);
  const nextValues: Partial<typeof tables.scheduleAutomations.$inferInsert> = {};

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
    .update(tables.scheduleAutomations)
    .set({
      ...nextValues,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.scheduleAutomations.automationId, input.automationId));
}

async function updateAutomationTargetRow(
  tx: ControlPlaneTransaction,
  automationTargetId: string,
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
    .update(tables.automationTargets)
    .set({
      sandboxProfileId: nextTarget.sandboxProfileId,
      sandboxProfileVersion: nextTarget.sandboxProfileVersion,
      primaryRepositoryId: nextTarget.primaryRepositoryId,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.automationTargets.id, automationTargetId));
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
