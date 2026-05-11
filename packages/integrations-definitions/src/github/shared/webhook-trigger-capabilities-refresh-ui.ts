import type { IntegrationWebhookTriggerCapabilitiesRefreshUi } from "@mistle/integrations-core";

export const GitHubWebhookTriggerCapabilitiesRefreshUi = {
  actionLabel: "Sync webhook events",
  pendingLabel: "Syncing...",
  disabledWhen: {
    missingConnectionConfigField: "installation_id",
    message: "Install the GitHub App before syncing webhook events.",
  },
} satisfies IntegrationWebhookTriggerCapabilitiesRefreshUi;
