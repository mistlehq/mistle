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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  type ConnectDialogState,
  ConnectMethodIds,
  ConnectIntegrationDialog,
  type ConnectMethodId,
} from "../integrations/connect-integration-dialog.js";
import { buildIntegrationCards } from "../integrations/directory-model.js";
import { formatConnectionCount } from "../integrations/format-connection-count.js";
import { IntegrationSection } from "../integrations/integration-section.js";
import { IntegrationTile } from "../integrations/integration-tile.js";
import {
  createApiKeyIntegrationConnection,
  listIntegrationDirectory,
  startOAuthIntegrationConnection,
} from "../integrations/integrations-service.js";
import {
  type ViewDialogState,
  ViewConnectionsDialog,
} from "../integrations/view-connections-dialog.js";

const SETTINGS_INTEGRATIONS_QUERY_KEY: readonly ["settings", "integrations", "directory"] = [
  "settings",
  "integrations",
  "directory",
];

function toConnectMethods(
  supportedAuthSchemes: readonly ("oauth" | "api-key")[] | undefined,
): readonly ConnectMethodId[] {
  if (supportedAuthSchemes === undefined) {
    return [];
  }
  return supportedAuthSchemes.map((scheme) =>
    scheme === "api-key" ? ConnectMethodIds.API_KEY : ConnectMethodIds.OAUTH,
  );
}

export function IntegrationsPage() {
  const queryClient = useQueryClient();
  const [connectDialog, setConnectDialog] = useState<ConnectDialogState | null>(null);
  const [viewDialog, setViewDialog] = useState<ViewDialogState | null>(null);
  const [connectMethodId, setConnectMethodId] = useState<ConnectMethodId>(ConnectMethodIds.API_KEY);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);

  const integrationsQuery = useQuery({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
  });

  const createApiKeyMutation = useMutation({
    mutationFn: async (input: { targetKey: string; apiKey: string }) =>
      createApiKeyIntegrationConnection(input),
  });

  const startOAuthMutation = useMutation({
    mutationFn: async (input: { targetKey: string }) => startOAuthIntegrationConnection(input),
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

    return selectedCard.connections;
  }, [cards, viewDialog]);

  const activeIntegrationCards = useMemo(
    () =>
      cards.filter((card) => card.connections.some((connection) => connection.status === "active")),
    [cards],
  );

  const connectMutationPending = createApiKeyMutation.isPending || startOAuthMutation.isPending;

  function resetConnectDialogState(): void {
    setConnectDialog(null);
    setConnectMethodId(ConnectMethodIds.API_KEY);
    setApiKeyValue("");
    setConnectError(null);
  }

  function openConnectDialog(input: {
    targetKey: string;
    displayName: string;
    methods: readonly ConnectMethodId[];
  }): void {
    setConnectDialog({
      targetKey: input.targetKey,
      displayName: input.displayName,
      methods: input.methods,
    });
    const defaultMethod = input.methods[0];
    if (defaultMethod === undefined) {
      throw new Error(
        `Integration target '${input.targetKey}' does not declare any supported auth scheme.`,
      );
    }
    setConnectMethodId(defaultMethod);
    setApiKeyValue("");
    setConnectError(null);
  }

  function openViewDialog(input: { targetKey: string; displayName: string }): void {
    setViewDialog({
      targetKey: input.targetKey,
      displayName: input.displayName,
    });
  }

  async function runConnectAction(): Promise<void> {
    if (connectDialog === null) {
      throw new Error("Connect dialog is required to run a connect action.");
    }
    if (!connectDialog.methods.includes(connectMethodId)) {
      throw new Error(
        `Connect method '${connectMethodId}' is not supported for target '${connectDialog.targetKey}'.`,
      );
    }

    if (connectMethodId === ConnectMethodIds.API_KEY) {
      const normalizedApiKey = apiKeyValue.trim();
      if (normalizedApiKey.length === 0) {
        setConnectError("API key is required.");
        return;
      }

      await createApiKeyMutation.mutateAsync({
        targetKey: connectDialog.targetKey,
        apiKey: normalizedApiKey,
      });

      await queryClient.invalidateQueries({
        queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
      });

      resetConnectDialogState();
      return;
    }

    const started = await startOAuthMutation.mutateAsync({
      targetKey: connectDialog.targetKey,
    });
    globalThis.location.assign(started.authorizationUrl);
  }

  function handleRunConnectAction(): void {
    setConnectError(null);
    void runConnectAction().catch((error: unknown) => {
      setConnectError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not start integration connection.",
        }),
      );
    });
  }

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
              onAction={() =>
                openViewDialog({
                  targetKey: card.target.targetKey,
                  displayName: card.displayName,
                })
              }
            />
          );
        }}
        title="Connected"
      />

      <IntegrationSection
        cards={cards}
        renderTile={(card) => {
          const methods = toConnectMethods(card.target.supportedAuthSchemes);

          return (
            <IntegrationTile
              actionDisabled={methods.length === 0}
              actionLabel={methods.length === 0 ? "N/A" : "Add"}
              description={card.description}
              displayName={card.displayName}
              {...(card.target.logoKey === undefined ? {} : { logoKey: card.target.logoKey })}
              {...(card.configStatus === "invalid" ? { statusBadge: "Invalid config" } : {})}
              onAction={() =>
                openConnectDialog({
                  targetKey: card.target.targetKey,
                  displayName: card.displayName,
                  methods,
                })
              }
            />
          );
        }}
        title="Available Integrations"
      />

      <ConnectIntegrationDialog
        apiKeyValue={apiKeyValue}
        connectError={connectError}
        connectMethodId={connectMethodId}
        dialog={connectDialog}
        onApiKeyChange={(value) => {
          setApiKeyValue(value);
          setConnectError(null);
        }}
        onClose={resetConnectDialogState}
        onMethodChange={(methodId) => {
          setConnectMethodId(methodId);
          setConnectError(null);
        }}
        onSubmit={handleRunConnectAction}
        pending={connectMutationPending}
      />

      <ViewConnectionsDialog
        connections={selectedViewConnections}
        dialog={viewDialog}
        onClose={() => {
          setViewDialog(null);
        }}
      />
    </div>
  );
}
