import type { ReactNode } from "react";

import type { IntegrationWebhookEventsSyncFlowRefresh } from "./integration-webhook-events-sync-flow-types.js";
import type { IntegrationConnection } from "./integrations-service.js";
import { useSlackWebhookEventsSyncFlow } from "./slack-webhook-events-sync-flow.js";

export function useIntegrationWebhookEventsSyncFlow(input: {
  connections: readonly IntegrationConnection[];
  refreshTriggerCapabilities: IntegrationWebhookEventsSyncFlowRefresh;
  refreshTriggerCapabilitiesError: { connectionId: string; message: string } | null;
  refreshingTriggerCapabilitiesConnectionId: string | null;
}): {
  dialog: ReactNode;
  webhookEventsSyncAction: (input: { connectionId: string }) => ReactNode;
} {
  return useSlackWebhookEventsSyncFlow(input);
}
