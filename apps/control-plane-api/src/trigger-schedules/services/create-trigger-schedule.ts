import {
  TriggerKinds,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  ScheduleKinds,
  ScheduleTargetTypes,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type { OpenWorkflow } from "openworkflow";

import { TriggerSchedulesBadRequestCodes } from "../constants.js";
import { loadScheduleTriggerAggregateOrThrow } from "./load-schedule-trigger-aggregate-or-throw.js";
import { enqueueOneOffScheduleWorkflow } from "./one-off-schedule-workflow.js";
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
  schedule:
    | {
        kind?: "recurring" | undefined;
        cronExpression: string;
        timezone: string;
        name?: string | undefined;
      }
    | {
        kind: "one_off";
        startAt: string;
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
  kind: "recurring" | "one_off";
  nextScheduledAt: string | null;
  startAt: string | null;
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
  ctx: { db: ControlPlaneDatabase; openWorkflow: Pick<OpenWorkflow, "runWorkflow"> },
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
  const scheduleTiming = resolveCreateScheduleTiming(input);

  const trigger = await ctx.db.transaction(async (tx) => {
    const trigger = await createTriggerAggregate(tx, {
      ...input,
      enabled,
      kind: scheduleTiming.kind,
      nextScheduledAt: enabled ? scheduleTiming.nextScheduledAt : null,
      startAt: scheduleTiming.startAt,
      target: {
        sandboxProfileId: input.target.sandboxProfileId,
        sandboxProfileVersion,
        primaryRepositoryId: input.target.primaryRepositoryId ?? null,
      },
    });

    return await loadScheduleTriggerAggregateOrThrow(
      { db: tx },
      {
        organizationId: input.organizationId,
        triggerId: trigger.id,
      },
    );
  });

  if (
    trigger.schedule.kind === ScheduleKinds.ONE_OFF &&
    trigger.schedule.enabled &&
    trigger.schedule.nextScheduledAt !== null
  ) {
    await enqueueOneOffScheduleWorkflow(
      {
        db: ctx.db,
        openWorkflow: ctx.openWorkflow,
      },
      {
        scheduleId: trigger.schedule.id,
        availableAt: new Date(trigger.schedule.nextScheduledAt),
      },
    );

    return await loadScheduleTriggerAggregateOrThrow(
      { db: ctx.db },
      {
        organizationId: input.organizationId,
        triggerId: trigger.id,
      },
    );
  }

  return trigger;
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
      kind: input.kind,
      name: input.schedule.name ?? input.name,
      cronExpression: input.schedule.kind === "one_off" ? null : input.schedule.cronExpression,
      timezone: input.schedule.kind === "one_off" ? null : input.schedule.timezone,
      enabled: input.enabled,
      nextScheduledAt: input.nextScheduledAt,
      startAt: input.startAt,
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

function resolveCreateScheduleTiming(input: CreateScheduleTriggerInput): {
  kind: "recurring" | "one_off";
  nextScheduledAt: string | null;
  startAt: string | null;
} {
  if (input.schedule.kind === "one_off") {
    const startAt = resolveStartAtOrThrow(input.schedule.startAt).toISOString();
    return {
      kind: "one_off",
      nextScheduledAt: startAt,
      startAt,
    };
  }

  return {
    kind: "recurring",
    nextScheduledAt: resolveNextScheduledAtOrThrow({
      cronExpression: input.schedule.cronExpression,
      timezone: input.schedule.timezone,
      now: input.now,
    }),
    startAt: null,
  };
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
