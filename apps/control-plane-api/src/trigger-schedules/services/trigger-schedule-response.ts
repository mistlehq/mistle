import type { TriggerScheduleAggregate } from "./load-schedule-trigger-aggregate-or-throw.js";

export function toTriggerScheduleResponse(aggregate: TriggerScheduleAggregate) {
  return {
    id: aggregate.id,
    name: aggregate.name,
    enabled: aggregate.enabled,
    createdAt: aggregate.createdAt,
    updatedAt: aggregate.updatedAt,
    schedule: {
      id: aggregate.schedule.id,
      kind: aggregate.schedule.kind,
      name: aggregate.schedule.name,
      cronExpression: aggregate.schedule.cronExpression,
      timezone: aggregate.schedule.timezone,
      enabled: aggregate.schedule.enabled,
      nextScheduledAt: normalizeTimestamp(aggregate.schedule.nextScheduledAt),
      lastScheduledAt: normalizeTimestamp(aggregate.schedule.lastScheduledAt),
      startAt: normalizeTimestamp(aggregate.schedule.startAt),
    },
    inputTemplate: aggregate.inputTemplate,
    conversationKeyTemplate: aggregate.conversationKeyTemplate,
    idempotencyKeyTemplate: aggregate.idempotencyKeyTemplate,
    target: aggregate.target,
  };
}

function normalizeTimestamp(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid persisted schedule timestamp '${value}'.`);
  }

  return timestamp.toISOString();
}
