import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
} from "@mistle/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  buildIntegrationCards,
  type IntegrationCardStatus,
} from "../integrations/directory-model.js";
import {
  createApiKeyIntegrationConnection,
  listIntegrationDirectory,
  startOAuthIntegrationConnection,
  type IntegrationConnection,
} from "../integrations/integrations-service.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";

type ConnectMethodId = "api-key" | "oauth";

type ConnectDialogState = {
  targetKey: string;
  displayName: string;
};

type ViewDialogState = {
  targetKey: string;
  displayName: string;
};

const SETTINGS_INTEGRATIONS_QUERY_KEY: readonly ["settings", "integrations", "directory"] = [
  "settings",
  "integrations",
  "directory",
];

function resolveConnectionStatusLabel(status: IntegrationConnection["status"]): string {
  if (status === "active") {
    return "Connected";
  }
  if (status === "error") {
    return "Error";
  }

  return "Revoked";
}

function resolveConnectionStatusVariant(status: IntegrationConnection["status"]): {
  className?: string;
  variant: "secondary" | "destructive" | "outline";
} {
  if (status === "active") {
    return {
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
      variant: "secondary",
    };
  }

  if (status === "error") {
    return {
      variant: "destructive",
    };
  }

  return {
    variant: "outline",
  };
}

export function IntegrationsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [connectDialog, setConnectDialog] = useState<ConnectDialogState | null>(null);
  const [viewDialog, setViewDialog] = useState<ViewDialogState | null>(null);
  const [connectMethodId, setConnectMethodId] = useState<ConnectMethodId>("api-key");
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

  function resetConnectDialogState(): void {
    setConnectDialog(null);
    setConnectMethodId("api-key");
    setApiKeyValue("");
    setConnectError(null);
  }

  function openConnectDialog(input: { targetKey: string; displayName: string }): void {
    setConnectDialog({
      targetKey: input.targetKey,
      displayName: input.displayName,
    });
    setConnectMethodId("api-key");
    setApiKeyValue("");
    setConnectError(null);
  }

  function openViewDialog(input: { targetKey: string; displayName: string }): void {
    setViewDialog({
      targetKey: input.targetKey,
      displayName: input.displayName,
    });
  }

  const connectMutationPending = createApiKeyMutation.isPending || startOAuthMutation.isPending;

  async function runConnectAction(): Promise<void> {
    if (connectDialog === null) {
      throw new Error("Connect dialog is required to run a connect action.");
    }

    if (connectMethodId === "api-key") {
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
    <div className="gap-4 flex flex-col">
      <div className="gap-3 flex flex-col">
        {cards.map((card) => (
          <div className="border rounded-md p-3" key={card.target.targetKey}>
            <div className="items-center justify-between gap-3 flex">
              <div className="gap-1 flex flex-col">
                <div className="items-center gap-2 flex">
                  <IntegrationNameBadge
                    displayName={card.displayName}
                    familyId={card.target.familyId}
                  />
                  <p className="text-sm font-medium">{card.displayName}</p>
                  <IntegrationStatusBadge status={card.status} />
                </div>
                <p className="text-muted-foreground text-xs">{card.description}</p>
              </div>
              <div className="items-center gap-2 flex">
                {card.connections.length > 0 ? (
                  <Button
                    onClick={() =>
                      openViewDialog({
                        targetKey: card.target.targetKey,
                        displayName: card.displayName,
                      })
                    }
                    type="button"
                    variant="outline"
                  >
                    View connections ({card.connections.length})
                  </Button>
                ) : null}
                <Button
                  onClick={() =>
                    openConnectDialog({
                      targetKey: card.target.targetKey,
                      displayName: card.displayName,
                    })
                  }
                  type="button"
                >
                  {card.connections.length > 0 ? "Connect another" : "Connect"}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            resetConnectDialogState();
          }
        }}
        open={connectDialog !== null}
      >
        {connectDialog ? (
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Connect {connectDialog.displayName}?</DialogTitle>
              <DialogDescription>
                Choose an authentication method to create the integration connection.
              </DialogDescription>
            </DialogHeader>

            <RadioGroup
              className="gap-2"
              name={`connect-auth-method-${connectDialog.targetKey}`}
              onValueChange={(nextValue) => {
                if (nextValue === "api-key" || nextValue === "oauth") {
                  setConnectMethodId(nextValue);
                  setConnectError(null);
                }
              }}
              value={connectMethodId}
            >
              <label
                className="inline-flex items-center gap-2 text-sm"
                htmlFor={`connect-auth-method-${connectDialog.targetKey}-api-key`}
              >
                <RadioGroupItem
                  aria-label="API key"
                  id={`connect-auth-method-${connectDialog.targetKey}-api-key`}
                  value="api-key"
                />
                <span>API key</span>
              </label>
              <label
                className="inline-flex items-center gap-2 text-sm"
                htmlFor={`connect-auth-method-${connectDialog.targetKey}-oauth`}
              >
                <RadioGroupItem
                  aria-label="OAuth"
                  id={`connect-auth-method-${connectDialog.targetKey}-oauth`}
                  value="oauth"
                />
                <span>OAuth</span>
              </label>
            </RadioGroup>

            {connectMethodId === "api-key" ? (
              <div className="gap-2 flex flex-col">
                <p className="text-sm font-medium">API key</p>
                <Input
                  autoComplete="off"
                  onChange={(event) => {
                    setApiKeyValue(event.currentTarget.value);
                    setConnectError(null);
                  }}
                  placeholder="sk-..."
                  type="password"
                  value={apiKeyValue}
                />
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Continue to generate an OAuth authorization URL and redirect.
              </p>
            )}

            {connectError ? <p className="text-destructive text-sm">{connectError}</p> : null}

            <DialogFooter>
              <Button onClick={resetConnectDialogState} type="button" variant="outline">
                Cancel
              </Button>
              <Button
                disabled={connectMutationPending}
                onClick={handleRunConnectAction}
                type="button"
              >
                {connectMethodId === "api-key" ? "Create connection" : "Continue with OAuth"}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setViewDialog(null);
          }
        }}
        open={viewDialog !== null}
      >
        {viewDialog ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{viewDialog.displayName} connections</DialogTitle>
              <DialogDescription>
                Review existing connections for this integration.
              </DialogDescription>
            </DialogHeader>
            <div className="gap-2 flex flex-col">
              {selectedViewConnections.map((connection) => {
                const statusUi = resolveConnectionStatusVariant(connection.status);
                return (
                  <div className="border rounded-md p-3" key={connection.id}>
                    <div className="items-center justify-between gap-2 flex">
                      <p className="text-sm font-medium">{connection.id}</p>
                      <Badge className={statusUi.className} variant={statusUi.variant}>
                        {resolveConnectionStatusLabel(connection.status)}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Created: {connection.createdAt}
                    </p>
                    <p className="text-muted-foreground text-xs">Updated: {connection.updatedAt}</p>
                  </div>
                );
              })}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function IntegrationNameBadge(input: { familyId: string; displayName: string }): React.JSX.Element {
  const normalizedFamilyId = input.familyId.trim().toLowerCase();
  if (normalizedFamilyId === "openai" || normalizedFamilyId === "github") {
    return (
      <img
        alt={`${input.displayName} logo`}
        className="h-5 w-5 rounded-sm"
        src={resolveIntegrationLogoPath({ logoKey: normalizedFamilyId })}
      />
    );
  }

  const firstCharacter = input.displayName.slice(0, 1).toUpperCase();
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-muted-foreground text-[10px] font-semibold">
      {firstCharacter}
    </span>
  );
}

function IntegrationStatusBadge(input: { status: IntegrationCardStatus }): React.JSX.Element {
  if (input.status === "Connected") {
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600/90" variant="secondary">
        {input.status}
      </Badge>
    );
  }

  if (input.status === "Error") {
    return <Badge variant="destructive">{input.status}</Badge>;
  }

  return <Badge variant="outline">{input.status}</Badge>;
}
