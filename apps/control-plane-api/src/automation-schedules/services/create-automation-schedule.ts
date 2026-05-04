import {
  AutomationKinds,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  ScheduleTargetTypes,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";

import { loadScheduleAutomationAggregateOrThrow } from "./load-schedule-automation-aggregate-or-throw.js";
import {
  assertPrimaryRepositoryReferenceOrThrow,
  resolveNextScheduledAtOrThrow,
  resolveSandboxProfileVersionOrThrow,
} from "./validation.js";

const DefaultConversationKeyTemplate = "{{schedule.id}}";
const DefaultIdempotencyKeyTemplate = "{{schedule.scheduledActionId}}";

export type CreateScheduleAutomationInput = {
  organizationId: string;
  name: string;
  enabled?: boolean | undefined;
  schedule: {
    cronExpression: string;
    timezone: string;
    name?: string | undefined;
  };
  inputTemplate: string;
  conversationKeyTemplate?: string | undefined;
  idempotencyKeyTemplate?: string | null | undefined;
  target: {
    sandboxProfileId: string;
    sandboxProfileVersion?: number | undefined;
    primaryRepositoryId?: string | null | undefined;
  };
  now: Date;
};

type CreateScheduleAutomationPersistenceInput = Omit<
  CreateScheduleAutomationInput,
  "enabled" | "now" | "target"
> & {
  enabled: boolean;
  nextScheduledAt: string | null;
  target: {
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    primaryRepositoryId: string | null;
  };
};

export function resolveCreateScheduleAutomationIdempotencyKeyTemplate(
  value: string | null | undefined,
): string | null {
  return value === undefined ? DefaultIdempotencyKeyTemplate : value;
}

export async function createAutomationSchedule(
  ctx: { db: ControlPlaneDatabase },
  input: CreateScheduleAutomationInput,
) {
  const sandboxProfileVersion = await resolveSandboxProfileVersionOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      sandboxProfileId: input.target.sandboxProfileId,
      sandboxProfileVersion: input.target.sandboxProfileVersion,
    },
  );
  await assertPrimaryRepositoryReferenceOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      sandboxProfileId: input.target.sandboxProfileId,
      sandboxProfileVersion,
      primaryRepositoryId: input.target.primaryRepositoryId ?? null,
    },
  );

  const enabled = input.enabled ?? true;
  const resolvedNextScheduledAt = resolveNextScheduledAtOrThrow({
    cronExpression: input.schedule.cronExpression,
    timezone: input.schedule.timezone,
    now: input.now,
  });

  return ctx.db.transaction(async (tx) => {
    const automation = await createAutomationAggregate(tx, {
      ...input,
      enabled,
      nextScheduledAt: enabled ? resolvedNextScheduledAt : null,
      target: {
        sandboxProfileId: input.target.sandboxProfileId,
        sandboxProfileVersion,
        primaryRepositoryId: input.target.primaryRepositoryId ?? null,
      },
    });

    return loadScheduleAutomationAggregateOrThrow(
      { db: tx },
      {
        organizationId: input.organizationId,
        automationId: automation.id,
      },
    );
  });
}

async function createAutomationAggregate(
  tx: ControlPlaneTransaction,
  input: CreateScheduleAutomationPersistenceInput,
) {
  const tables = getControlPlaneDatabaseSchema(tx);
  const insertedAutomationRows = await tx
    .insert(tables.automations)
    .values({
      organizationId: input.organizationId,
      kind: AutomationKinds.SCHEDULE,
      name: input.name,
      enabled: input.enabled,
    })
    .returning({
      id: tables.automations.id,
    });

  const insertedAutomation = insertedAutomationRows[0];

  if (insertedAutomation === undefined) {
    throw new Error("Expected scheduled automation row to be inserted.");
  }

  const insertedScheduleRows = await tx
    .insert(tables.schedules)
    .values({
      organizationId: input.organizationId,
      targetType: ScheduleTargetTypes.AUTOMATION_RUN,
      name: input.schedule.name ?? input.name,
      cronExpression: input.schedule.cronExpression,
      timezone: input.schedule.timezone,
      enabled: input.enabled,
      nextScheduledAt: input.nextScheduledAt,
    })
    .returning({
      id: tables.schedules.id,
    });

  const insertedSchedule = insertedScheduleRows[0];

  if (insertedSchedule === undefined) {
    throw new Error("Expected schedule row to be inserted.");
  }

  await tx.insert(tables.scheduleAutomations).values({
    scheduleId: insertedSchedule.id,
    automationId: insertedAutomation.id,
    inputTemplate: input.inputTemplate,
    conversationKeyTemplate: input.conversationKeyTemplate ?? DefaultConversationKeyTemplate,
    idempotencyKeyTemplate: resolveCreateScheduleAutomationIdempotencyKeyTemplate(
      input.idempotencyKeyTemplate,
    ),
  });

  await tx.insert(tables.automationTargets).values({
    automationId: insertedAutomation.id,
    sandboxProfileId: input.target.sandboxProfileId,
    sandboxProfileVersion: input.target.sandboxProfileVersion,
    primaryRepositoryId: input.target.primaryRepositoryId,
  });

  return insertedAutomation;
}
