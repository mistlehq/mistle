import type {
  AutomationListEvent,
  AutomationListIssue,
  AutomationListItem,
} from "./automations-types.js";

export type AutomationListTargetViewModel = {
  sandboxProfileId: string;
  sandboxProfileName: string | null;
  primaryRepositoryId: string | null;
  primaryRepositoryName: string | null;
};

export type AutomationListScheduleSourceViewModel = {
  kind: "schedule";
  cronExpression: string;
  timezone: string;
  nextScheduledAtLabel: string | null;
  timezoneOffsetLabel: string;
};

export type AutomationListWebhookSourceViewModel = {
  kind: "webhook";
  events: readonly AutomationListEvent[];
};

export type AutomationListItemViewModel = {
  id: string;
  kind: AutomationListItem["kind"];
  name: string;
  enabled: boolean;
  target: AutomationListTargetViewModel;
  issue?: AutomationListIssue;
  source: AutomationListWebhookSourceViewModel | AutomationListScheduleSourceViewModel;
  updatedAtLabel: string;
};
