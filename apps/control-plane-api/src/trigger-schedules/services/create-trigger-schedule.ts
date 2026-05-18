import {
  TriggerKinds,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  ScheduleTargetTypes,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";

import { loadScheduleTriggerAggregateOrThrow } from "./load-schedule-trigger-aggregate-or-throw.js";
import {
  assertPrimaryRepositoryReferenceOrThrow,
  resolveNextScheduledAtOrThrow,
  resolveSandboxProfileVersionOrThrow,
} from "./validation.js";

const DefaultConversationKeyTemplate = "{{schedule.id}}";
const DefaultIdempotencyKeyTemplate = "{{schedule.scheduledActionId}}";

export type CreateScheduleTriggerInput = {
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

type CreateScheduleTriggerPersistenceInput = Omit<
  CreateScheduleTriggerInput,
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

export function resolveCreateScheduleTriggerIdempotencyKeyTemplate(
  value: string | null | undefined,
): string | null {
  return value === undefined ? DefaultIdempotencyKeyTemplate : value;
}

export async function createTriggerSchedule(
  ctx: { db: ControlPlaneDatabase },
  input: CreateScheduleTriggerInput,
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
    const trigger = await createTriggerAggregate(tx, {
      ...input,
      enabled,
      nextScheduledAt: enabled ? resolvedNextScheduledAt : null,
      target: {
        sandboxProfileId: input.target.sandboxProfileId,
        sandboxProfileVersion,
        primaryRepositoryId: input.target.primaryRepositoryId ?? null,
      },
    });

    return loadScheduleTriggerAggregateOrThrow(
      { db: tx },
      {
        organizationId: input.organizationId,
        triggerId: trigger.id,
      },
    );
  });
}

async function createTriggerAggregate(
  tx: ControlPlaneTransaction,
  input: CreateScheduleTriggerPersistenceInput,
) {
  const tables = getControlPlaneDatabaseSchema(tx);
  const insertedTriggerRows = await tx
    .insert(tables.triggers)
    .values({
      organizationId: input.organizationId,
      kind: TriggerKinds.SCHEDULE,
      name: input.name,
      enabled: input.enabled,
    })
    .returning({
      id: tables.triggers.id,
    });

  const insertedTrigger = insertedTriggerRows[0];

  if (insertedTrigger === undefined) {
    throw new Error("Expected scheduled trigger row to be inserted.");
  }

  const insertedScheduleRows = await tx
    .insert(tables.schedules)
    .values({
      organizationId: input.organizationId,
      targetType: ScheduleTargetTypes.TRIGGER_RUN,
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

  await tx.insert(tables.scheduleTriggers).values({
    scheduleId: insertedSchedule.id,
    triggerId: insertedTrigger.id,
    inputTemplate: input.inputTemplate,
    conversationKeyTemplate: input.conversationKeyTemplate ?? DefaultConversationKeyTemplate,
    idempotencyKeyTemplate: resolveCreateScheduleTriggerIdempotencyKeyTemplate(
      input.idempotencyKeyTemplate,
    ),
  });

  await tx.insert(tables.triggerTargets).values({
    triggerId: insertedTrigger.id,
    sandboxProfileId: input.target.sandboxProfileId,
    sandboxProfileVersion: input.target.sandboxProfileVersion,
    primaryRepositoryId: input.target.primaryRepositoryId,
  });

  return insertedTrigger;
}
