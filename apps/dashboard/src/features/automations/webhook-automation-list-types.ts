import type {
  WebhookAutomationListEvent,
  WebhookAutomationListIssue,
} from "./webhook-automations-types.js";

export type WebhookAutomationListItemViewModel = {
  id: string;
  name: string;
  enabled: boolean;
  targetName: string;
  issue?: WebhookAutomationListIssue;
  events: readonly WebhookAutomationListEvent[];
  updatedAtLabel: string;
};
