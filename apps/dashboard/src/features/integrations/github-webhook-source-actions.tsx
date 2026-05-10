import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { Button } from "@mistle/ui";
import { useCallback, type ReactNode } from "react";

import type { IntegrationWebhookSourceActionsRefreshTriggerCapabilities } from "./integration-webhook-source-actions-types.js";
import type { IntegrationConnection } from "./integrations-service.js";

export function useGitHubWebhookSourceActions(input: {
  connections: readonly IntegrationConnection[];
  refreshTriggerCapabilities: IntegrationWebhookSourceActionsRefreshTriggerCapabilities;
  refreshingTriggerCapabilitiesConnectionId: string | null;
}): {
  dialog: ReactNode;
  renderWebhookSourceActions: (input: { connectionId: string }) => ReactNode;
} {
  const renderWebhookSourceActions = useCallback(
    (actionInput: { connectionId: string }): ReactNode => {
      const connection =
        input.connections.find((candidate) => candidate.id === actionInput.connectionId) ?? null;
      if (!supportsGitHubWebhookEventsSync(connection)) {
        return null;
      }

      const isPending =
        input.refreshingTriggerCapabilitiesConnectionId === actionInput.connectionId;

      return (
        <Button
          disabled={isPending}
          onClick={() => {
            input.refreshTriggerCapabilities({
              body: {},
              connectionId: actionInput.connectionId,
            });
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {isPending ? "Syncing..." : "Sync webhook events"}
        </Button>
      );
    },
    [
      input.connections,
      input.refreshTriggerCapabilities,
      input.refreshingTriggerCapabilitiesConnectionId,
    ],
  );

  return {
    dialog: null,
    renderWebhookSourceActions,
  };
}

function supportsGitHubWebhookEventsSync(connection: IntegrationConnection | null): boolean {
  return (
    connection?.connectionMethodId === IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION &&
    typeof connection.config?.["installation_id"] === "string" &&
    connection.config["installation_id"].trim().length > 0
  );
}
