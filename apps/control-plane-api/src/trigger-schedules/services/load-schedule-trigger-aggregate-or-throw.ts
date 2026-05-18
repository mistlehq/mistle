import {
  TriggerKinds,
  ScheduleTargetTypes,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";

export type TriggerScheduleAggregate = {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  schedule: {
    id: string;
    name: string;
    cronExpression: string;
    timezone: string;
    enabled: boolean;
    nextScheduledAt: string | null;
    lastScheduledAt: string | null;
  };
  inputTemplate: string;
  conversationKeyTemplate: string;
  idempotencyKeyTemplate: string | null;
  target: {
    id: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    primaryRepositoryId: string | null;
  };
};

export async function loadScheduleTriggerAggregateOrThrow(
  ctx: { db: ControlPlaneDatabase | ControlPlaneTransaction },
  input: {
    organizationId: string;
    triggerId: string;
  },
): Promise<TriggerScheduleAggregate> {
  const trigger = await ctx.db.query.triggers.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, input.triggerId),
        eq(table.organizationId, input.organizationId),
        eq(table.kind, TriggerKinds.SCHEDULE),
      ),
  });

  if (trigger === undefined) {
    throw new NotFoundError("NOT_FOUND", "Scheduled trigger was not found.");
  }

  const [scheduleTrigger, targets] = await Promise.all([
    ctx.db.query.scheduleTriggers.findFirst({
      where: (table, { eq }) => eq(table.triggerId, trigger.id),
    }),
    ctx.db.query.triggerTargets.findMany({
      where: (table, { eq }) => eq(table.triggerId, trigger.id),
    }),
  ]);

  if (scheduleTrigger === undefined) {
    throw new Error(`Scheduled trigger '${trigger.id}' is missing its schedule trigger row.`);
  }

  const schedule = await ctx.db.query.schedules.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, scheduleTrigger.scheduleId),
        eq(table.organizationId, input.organizationId),
        eq(table.targetType, ScheduleTargetTypes.TRIGGER_RUN),
      ),
  });

  if (schedule === undefined) {
    throw new Error(`Scheduled trigger '${trigger.id}' is missing its schedule row.`);
  }

  if (schedule.deletedAt !== null) {
    throw new NotFoundError("NOT_FOUND", "Scheduled trigger was not found.");
  }

  if (targets.length !== 1 || targets[0] === undefined) {
    throw new Error(`Scheduled trigger '${trigger.id}' must have exactly one trigger target.`);
  }

  const target = targets[0];

  return {
    id: trigger.id,
    name: trigger.name,
    enabled: trigger.enabled,
    createdAt: trigger.createdAt,
    updatedAt: trigger.updatedAt,
    schedule: {
      id: schedule.id,
      name: schedule.name,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      enabled: schedule.enabled,
      nextScheduledAt: schedule.nextScheduledAt,
      lastScheduledAt: schedule.lastScheduledAt,
    },
    inputTemplate: scheduleTrigger.inputTemplate,
    conversationKeyTemplate: scheduleTrigger.conversationKeyTemplate,
    idempotencyKeyTemplate: scheduleTrigger.idempotencyKeyTemplate,
    target: {
      id: target.id,
      sandboxProfileId: target.sandboxProfileId,
      sandboxProfileVersion: target.sandboxProfileVersion,
      primaryRepositoryId: target.primaryRepositoryId,
    },
  };
}
