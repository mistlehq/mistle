import type { ReactNode } from "react";

import type { IntegrationWebhookSourceActionsRefreshTriggerCapabilities } from "./integration-webhook-source-actions-types.js";
import type { IntegrationConnection } from "./integrations-service.js";
import { useSlackWebhookSourceActions } from "./slack-webhook-source-actions.js";

export function useIntegrationWebhookSourceActions(input: {
  connections: readonly IntegrationConnection[];
  refreshTriggerCapabilities: IntegrationWebhookSourceActionsRefreshTriggerCapabilities;
  refreshTriggerCapabilitiesError: { connectionId: string; message: string } | null;
  refreshingTriggerCapabilitiesConnectionId: string | null;
}): {
  dialog: ReactNode;
  renderWebhookSourceActions: (input: { connectionId: string }) => ReactNode;
} {
  return useSlackWebhookSourceActions(input);
}
