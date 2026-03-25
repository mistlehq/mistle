import type { WebhookAutomationListEvent } from "./webhook-automations-types.js";

export type WebhookAutomationListItemViewModel = {
  id: string;
  name: string;
  enabled: boolean;
  targetName: string;
  events: readonly WebhookAutomationListEvent[];
  updatedAtLabel: string;
};
