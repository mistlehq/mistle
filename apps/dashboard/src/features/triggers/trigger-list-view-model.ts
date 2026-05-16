import { formatDateTime, formatTimeZoneOffset } from "../shared/date-formatters.js";
import type {
  TriggerListItemViewModel,
  TriggerListScheduleSourceViewModel,
} from "./trigger-list-types.js";
import type { TriggerListItem } from "./triggers-types.js";
import { formatTriggerUpdatedAt } from "./webhook-trigger-formatters.js";

function toTriggerListScheduleSourceViewModel(
  source: Extract<TriggerListItem["source"], { kind: "schedule" }>,
): TriggerListScheduleSourceViewModel {
  const offsetDateTime = source.nextScheduledAt ?? new Date().toISOString();

  return {
    kind: "schedule",
    cronExpression: source.cronExpression,
    timezone: source.timezone,
    nextScheduledAtLabel:
      source.nextScheduledAt === null
        ? null
        : formatDateTime(source.nextScheduledAt, source.timezone),
    timezoneOffsetLabel: formatTimeZoneOffset({
      isoDateTime: offsetDateTime,
      timeZone: source.timezone,
    }),
  };
}

export function toTriggerListItemViewModel(trigger: TriggerListItem): TriggerListItemViewModel {
  return {
    id: trigger.id,
    kind: trigger.kind,
    name: trigger.name,
    enabled: trigger.enabled,
    target: trigger.target,
    ...(trigger.issue === undefined ? {} : { issue: trigger.issue }),
    source:
      trigger.source.kind === "webhook"
        ? trigger.source
        : toTriggerListScheduleSourceViewModel(trigger.source),
    updatedAtLabel: formatTriggerUpdatedAt(trigger.updatedAt),
  };
}
