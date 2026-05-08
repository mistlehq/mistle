import { SlackConnectionMethodId } from "@mistle/integrations-definitions/browser";
import { Button } from "@mistle/ui";
import { useCallback, useState, type ReactNode } from "react";

import type { IntegrationWebhookSourceActionsRefreshTriggerCapabilities } from "./integration-webhook-source-actions-types.js";
import type { IntegrationConnection } from "./integrations-service.js";
import { SlackWebhookEventsSyncDialog } from "./slack-webhook-events-sync-dialog.js";

export function useSlackWebhookSourceActions(input: {
  connections: readonly IntegrationConnection[];
  refreshTriggerCapabilities: IntegrationWebhookSourceActionsRefreshTriggerCapabilities;
  refreshTriggerCapabilitiesError: { connectionId: string; message: string } | null;
  refreshingTriggerCapabilitiesConnectionId: string | null;
}): {
  dialog: ReactNode;
  renderWebhookSourceActions: (input: { connectionId: string }) => ReactNode;
} {
  const [syncConnectionId, setSyncConnectionId] = useState<string | null>(null);

  const renderWebhookSourceActions = useCallback(
    (actionInput: { connectionId: string }): ReactNode => {
      const connection =
        input.connections.find((candidate) => candidate.id === actionInput.connectionId) ?? null;
      if (!supportsSlackWebhookEventsSync(connection)) {
        return null;
      }

      return (
        <Button
          onClick={() => {
            setSyncConnectionId(actionInput.connectionId);
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          Sync webhook events
        </Button>
      );
    },
    [input.connections],
  );

  return {
    dialog: (
      <SlackWebhookEventsSyncDialog
        errorMessage={
          input.refreshTriggerCapabilitiesError?.connectionId === syncConnectionId
            ? input.refreshTriggerCapabilitiesError.message
            : null
        }
        isOpen={syncConnectionId !== null}
        isPending={input.refreshingTriggerCapabilitiesConnectionId === syncConnectionId}
        onOpenChange={(open) => {
          if (!open) {
            setSyncConnectionId(null);
          }
        }}
        onSync={(appConfigToken) => {
          if (syncConnectionId === null) {
            throw new Error("Slack webhook events sync requires an integration connection.");
          }

          input.refreshTriggerCapabilities(
            {
              body: { appConfigToken },
              connectionId: syncConnectionId,
            },
            {
              onSuccess: () => {
                setSyncConnectionId(null);
              },
            },
          );
        }}
      />
    ),
    renderWebhookSourceActions,
  };
}

function supportsSlackWebhookEventsSync(connection: IntegrationConnection | null): boolean {
  return (
    connection?.connectionMethodId === SlackConnectionMethodId &&
    typeof connection.config?.["app_id"] === "string" &&
    connection.config["app_id"].trim().length > 0
  );
}
