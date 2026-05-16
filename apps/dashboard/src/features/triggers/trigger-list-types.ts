import type { TriggerListEvent, TriggerListIssue, TriggerListItem } from "./triggers-types.js";

export type TriggerListTargetViewModel = {
  sandboxProfileId: string;
  sandboxProfileName: string | null;
  primaryRepositoryId: string | null;
  primaryRepositoryName: string | null;
};

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
  target: TriggerListTargetViewModel;
  issue?: TriggerListIssue;
  source: TriggerListWebhookSourceViewModel | TriggerListScheduleSourceViewModel;
  updatedAtLabel: string;
};
