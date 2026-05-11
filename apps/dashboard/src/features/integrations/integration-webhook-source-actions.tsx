import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@mistle/ui";
import { useCallback, useState, type ReactNode } from "react";

import type { IntegrationWebhookSourceActionsRefreshTriggerCapabilities } from "./integration-webhook-source-actions-types.js";
import { IntegrationWebhookTriggerCapabilitiesRefreshDialog } from "./integration-webhook-trigger-capabilities-refresh-dialog.js";
import type { IntegrationConnection } from "./integrations-service.js";

type IntegrationWebhookSourceActionsInput = {
  connections: readonly IntegrationConnection[];
  refreshTriggerCapabilities: IntegrationWebhookSourceActionsRefreshTriggerCapabilities;
  refreshingTriggerCapabilitiesConnectionId: string | null;
};

type IntegrationWebhookSourceActionsResult = {
  dialog: ReactNode;
  renderWebhookSourceActions: (input: { connectionId: string }) => ReactNode;
};

export function useIntegrationWebhookSourceActions(
  input: IntegrationWebhookSourceActionsInput,
): IntegrationWebhookSourceActionsResult {
  const [syncConnectionId, setSyncConnectionId] = useState<string | null>(null);
  const syncConnection =
    syncConnectionId === null
      ? null
      : (input.connections.find((connection) => connection.id === syncConnectionId) ?? null);
  const syncAction = syncConnection?.webhookTriggerCapabilitiesRefreshAction ?? null;

  const renderWebhookSourceActions = useCallback(
    (actionInput: { connectionId: string }): ReactNode => {
      const connection =
        input.connections.find((candidate) => candidate.id === actionInput.connectionId) ?? null;
      const action = connection?.webhookTriggerCapabilitiesRefreshAction;
      if (connection === null || action === undefined) {
        return null;
      }

      const isPending =
        input.refreshingTriggerCapabilitiesConnectionId === actionInput.connectionId;
      const button = (
        <Button
          disabled={isPending || action.disabledMessage !== undefined}
          onClick={() => {
            if (action.bodyForm === undefined) {
              input.refreshTriggerCapabilities({
                body: {},
                connectionId: actionInput.connectionId,
              });
              return;
            }

            setSyncConnectionId(actionInput.connectionId);
          }}
          size="sm"
          {...(action.disabledMessage === undefined ? {} : { title: action.disabledMessage })}
          type="button"
          variant="outline"
        >
          {isPending ? action.pendingLabel : action.actionLabel}
        </Button>
      );

      if (action.disabledMessage === undefined) {
        return button;
      }

      return (
        <Tooltip delay={0}>
          <TooltipTrigger render={<span className="inline-flex" />}>{button}</TooltipTrigger>
          <TooltipContent side="top">{action.disabledMessage}</TooltipContent>
        </Tooltip>
      );
    },
    [
      input.connections,
      input.refreshTriggerCapabilities,
      input.refreshingTriggerCapabilitiesConnectionId,
    ],
  );

  return {
    dialog: (
      <IntegrationWebhookTriggerCapabilitiesRefreshDialog
        action={syncAction}
        isOpen={syncConnectionId !== null}
        isPending={input.refreshingTriggerCapabilitiesConnectionId === syncConnectionId}
        onOpenChange={(open) => {
          if (!open) {
            setSyncConnectionId(null);
          }
        }}
        onSync={(body) => {
          if (syncConnectionId === null) {
            throw new Error("Webhook events sync requires an integration connection.");
          }

          input.refreshTriggerCapabilities({
            body,
            connectionId: syncConnectionId,
          });
          setSyncConnectionId(null);
        }}
      />
    ),
    renderWebhookSourceActions,
  };
}
