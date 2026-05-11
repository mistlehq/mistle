import { formatDateTime, formatTimeZoneOffset } from "../shared/date-formatters.js";
import type {
  AutomationListItemViewModel,
  AutomationListScheduleSourceViewModel,
} from "./automation-list-types.js";
import type { AutomationListItem } from "./automations-types.js";
import { formatAutomationUpdatedAt } from "./webhook-automation-formatters.js";

function toAutomationListScheduleSourceViewModel(
  source: Extract<AutomationListItem["source"], { kind: "schedule" }>,
): AutomationListScheduleSourceViewModel {
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

export function toAutomationListItemViewModel(
  automation: AutomationListItem,
): AutomationListItemViewModel {
  return {
    id: automation.id,
    kind: automation.kind,
    name: automation.name,
    enabled: automation.enabled,
    target: automation.target,
    ...(automation.issue === undefined ? {} : { issue: automation.issue }),
    source:
      automation.source.kind === "webhook"
        ? automation.source
        : toAutomationListScheduleSourceViewModel(automation.source),
    updatedAtLabel: formatAutomationUpdatedAt(automation.updatedAt),
  };
}
