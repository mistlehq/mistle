import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { buildIntegrationCards } from "../integrations/directory-model.js";
import { formatConnectionCount } from "../integrations/format-connection-count.js";
import {
  IntegrationConnectionDialog,
  IntegrationConnectionMethodIds,
  type IntegrationConnectionMethodId,
} from "../integrations/integration-connection-dialog.js";
import { IntegrationSection } from "../integrations/integration-section.js";
import { IntegrationTile } from "../integrations/integration-tile.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import {
  type ViewDialogState,
  ViewConnectionsDialog,
} from "../integrations/view-connections-dialog.js";
import { useIntegrationConnectionDialogState } from "./use-integration-connection-dialog-state.js";

const SETTINGS_INTEGRATIONS_QUERY_KEY: readonly ["settings", "integrations", "directory"] = [
  "settings",
  "integrations",
  "directory",
];

function toConnectionMethods(
  supportedAuthSchemes: readonly ("oauth" | "api-key")[] | undefined,
): readonly IntegrationConnectionMethodId[] {
  if (supportedAuthSchemes === undefined) {
    return [];
  }

  return supportedAuthSchemes.map((scheme) =>
    scheme === "api-key"
      ? IntegrationConnectionMethodIds.API_KEY
      : IntegrationConnectionMethodIds.OAUTH,
  );
}

export function IntegrationsPage() {
  const [viewDialog, setViewDialog] = useState<ViewDialogState | null>(null);

  const connectionDialogState = useIntegrationConnectionDialogState({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
  });

  const integrationsQuery = useQuery({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
  });

  const cards = useMemo(() => {
    if (!integrationsQuery.data) {
      return [];
    }

    return buildIntegrationCards(integrationsQuery.data);
  }, [integrationsQuery.data]);

  const selectedViewConnections = useMemo(() => {
    if (viewDialog === null) {
      return [];
    }

    const selectedCard = cards.find((card) => card.target.targetKey === viewDialog.targetKey);
    if (selectedCard === undefined) {
      throw new Error(`Integration card was not found for target '${viewDialog.targetKey}'.`);
    }

    return selectedCard.connections.filter((connection) => connection.status === "active");
  }, [cards, viewDialog]);

  const activeIntegrationCards = useMemo(
    () =>
      cards.filter((card) => card.connections.some((connection) => connection.status === "active")),
    [cards],
  );

  if (integrationsQuery.isPending) {
    return (
      <div className="gap-3 flex flex-col">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (integrationsQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load integrations</AlertTitle>
        <AlertDescription className="gap-3 flex flex-col items-start">
          <span>
            {resolveApiErrorMessage({
              error: integrationsQuery.error,
              fallbackMessage: "Could not load integrations.",
            })}
          </span>
          <Button
            onClick={() => {
              void integrationsQuery.refetch();
            }}
            type="button"
            variant="outline"
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (cards.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No integrations available</CardTitle>
          <CardDescription>
            No integration targets are currently configured for this environment. Seed integration
            targets in the control-plane database to populate this page.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    );
  }

  return (
    <div className="w-full gap-4 flex flex-col">
      <IntegrationSection
        cards={activeIntegrationCards}
        emptyStateMessage="No active integration connections yet. Add one from the integrations list below."
        renderTile={(card) => {
          return (
            <IntegrationTile
              actionLabel="View"
              actionVariant="outline"
              description={formatConnectionCount(card.connections.length)}
              displayName={card.displayName}
              {...(card.target.logoKey === undefined ? {} : { logoKey: card.target.logoKey })}
              {...(card.configStatus === "invalid" ? { statusBadge: "Invalid config" } : {})}
              onAction={() => {
                setViewDialog({
                  targetKey: card.target.targetKey,
                  displayName: card.displayName,
                });
              }}
            />
          );
        }}
        title="Connected"
      />

      <IntegrationSection
        cards={cards}
        renderTile={(card) => {
          const methods = toConnectionMethods(card.target.supportedAuthSchemes);

          return (
            <IntegrationTile
              actionDisabled={methods.length === 0}
              actionLabel={methods.length === 0 ? "N/A" : "Add"}
              description={card.description}
              displayName={card.displayName}
              {...(card.target.logoKey === undefined ? {} : { logoKey: card.target.logoKey })}
              {...(card.configStatus === "invalid" ? { statusBadge: "Invalid config" } : {})}
              onAction={() => {
                connectionDialogState.openDialog({
                  targetKey: card.target.targetKey,
                  targetDisplayName: card.displayName,
                  methods,
                  mode: "create",
                });
              }}
            />
          );
        }}
        title="Available Integrations"
      />

      <IntegrationConnectionDialog
        apiKeyValue={connectionDialogState.apiKeyValue}
        connectionDisplayNamePlaceholder={connectionDialogState.connectionDisplayNamePlaceholder}
        connectionDisplayNameValue={connectionDialogState.connectionDisplayNameValue}
        connectError={connectionDialogState.error}
        connectMethodId={connectionDialogState.methodId}
        dialog={connectionDialogState.dialog}
        hasChanges={connectionDialogState.hasChanges}
        isApiKeyChanged={connectionDialogState.isApiKeyChanged}
        isConnectionDisplayNameChanged={connectionDialogState.isConnectionDisplayNameChanged}
        onApiKeyChange={connectionDialogState.onApiKeyChange}
        onConnectionDisplayNameChange={connectionDialogState.onConnectionDisplayNameChange}
        onClose={connectionDialogState.closeDialog}
        onMethodChange={connectionDialogState.onMethodChange}
        onSubmit={connectionDialogState.submitDialog}
        pending={connectionDialogState.pending}
      />

      <ViewConnectionsDialog
        connections={selectedViewConnections}
        dialog={viewDialog}
        onClose={() => {
          setViewDialog(null);
        }}
        onOpenEditConnectionDialog={({
          connectionId,
          connectionDisplayName,
          connectionMethodId,
        }) => {
          if (viewDialog === null) {
            throw new Error("View dialog state is required to open edit connection dialog.");
          }

          setViewDialog(null);
          connectionDialogState.openDialog({
            targetKey: viewDialog.targetKey,
            targetDisplayName: viewDialog.displayName,
            mode: "update",
            connectionId,
            connectionDisplayName,
            currentMethodId:
              connectionMethodId === null
                ? IntegrationConnectionMethodIds.API_KEY
                : connectionMethodId,
          });
        }}
      />
    </div>
  );
}
