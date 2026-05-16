import type { TriggerListEvent, TriggerListIssue, TriggerListItem } from "./triggers-types.js";

export type TriggerListScheduleSourceViewModel = {
  kind: "schedule";
  cronExpression: string;
  timezone: string;
  nextScheduledAtLabel: string | null;
  timezoneOffsetLabel: string;
};

export type TriggerListWebhookSourceViewModel = {
  kind: "webhook";
  events: readonly TriggerListEvent[];
};

export type TriggerListItemViewModel = {
  id: string;
  kind: TriggerListItem["kind"];
  name: string;
  enabled: boolean;
  target: TriggerListItem["target"];
  issue?: TriggerListIssue;
  source: TriggerListWebhookSourceViewModel | TriggerListScheduleSourceViewModel;
  updatedAtLabel: string;
};
