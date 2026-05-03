import type {
  WebhookAutomationListEvent,
  WebhookAutomationListIssue,
} from "./webhook-automations-types.js";

export type AutomationListKind = "webhook" | "schedule";

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
};

export type AutomationListWebhookSourceViewModel = {
  kind: "webhook";
  events: readonly WebhookAutomationListEvent[];
};

export type AutomationListItemViewModel = {
  id: string;
  kind: AutomationListKind;
  name: string;
  enabled: boolean;
  target: AutomationListTargetViewModel;
  issue?: WebhookAutomationListIssue;
  source: AutomationListWebhookSourceViewModel | AutomationListScheduleSourceViewModel;
  updatedAtLabel: string;
};
