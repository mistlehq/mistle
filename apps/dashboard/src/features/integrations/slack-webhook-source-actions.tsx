import { SlackConnectionMethodId } from "@mistle/integrations-definitions/browser";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@mistle/ui";
import { useCallback, useState, type ReactNode } from "react";

import type { IntegrationWebhookSourceActionsRefreshTriggerCapabilities } from "./integration-webhook-source-actions-types.js";
import type { IntegrationConnection } from "./integrations-service.js";
import { SlackWebhookEventsSyncDialog } from "./slack-webhook-events-sync-dialog.js";

export function useSlackWebhookSourceActions(input: {
  connections: readonly IntegrationConnection[];
  refreshTriggerCapabilities: IntegrationWebhookSourceActionsRefreshTriggerCapabilities;
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
      if (!isSlackAppConnection(connection)) {
        return null;
      }

      const disabledMessage = resolveSlackWebhookEventsSyncDisabledMessage(connection);
      const isPending =
        input.refreshingTriggerCapabilitiesConnectionId === actionInput.connectionId;
      const button = (
        <Button
          disabled={isPending || disabledMessage !== null}
          onClick={() => {
            setSyncConnectionId(actionInput.connectionId);
          }}
          size="sm"
          {...(disabledMessage === null ? {} : { title: disabledMessage })}
          type="button"
          variant="outline"
        >
          {isPending ? "Syncing..." : "Sync webhook events"}
        </Button>
      );

      if (disabledMessage === null) {
        return button;
      }

      return (
        <Tooltip delay={0}>
          <TooltipTrigger render={<span className="inline-flex" />}>{button}</TooltipTrigger>
          <TooltipContent side="top">{disabledMessage}</TooltipContent>
        </Tooltip>
      );
    },
    [input.connections, input.refreshingTriggerCapabilitiesConnectionId],
  );

  return {
    dialog: (
      <SlackWebhookEventsSyncDialog
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

          input.refreshTriggerCapabilities({
            body: { appConfigToken },
            connectionId: syncConnectionId,
          });
          setSyncConnectionId(null);
        }}
      />
    ),
    renderWebhookSourceActions,
  };
}

function isSlackAppConnection(
  connection: IntegrationConnection | null,
): connection is IntegrationConnection {
  return connection?.connectionMethodId === SlackConnectionMethodId;
}

function resolveSlackWebhookEventsSyncDisabledMessage(
  connection: IntegrationConnection,
): string | null {
  return typeof connection.config?.["app_id"] === "string" &&
    connection.config["app_id"].trim().length > 0
    ? null
    : "Add the Slack App ID before syncing webhook events.";
}
