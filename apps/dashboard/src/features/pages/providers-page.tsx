import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem,
} from "@mistle/ui";
import { useMemo, useState } from "react";

import {
  canStartConnection,
  deriveProviderStatusFromConnections,
  getProviderAuthMethods,
  PROVIDER_SCAFFOLD_ENTRIES,
  resolveAutoSelectedAuthMethod,
  type ProviderCatalogEntry,
} from "../providers/model.js";

type ConnectDialogState = {
  providerInstanceId: string;
  providerDisplayName: string;
};

export function ProvidersPage(): React.JSX.Element {
  const [selectedAuthMethodId, setSelectedAuthMethodId] = useState<string | null>(null);
  const [connectDialog, setConnectDialog] = useState<ConnectDialogState | null>(null);

  const selectedAuthMethods = useMemo(() => {
    if (connectDialog === null) {
      return [];
    }

    return getProviderAuthMethods({
      entries: PROVIDER_SCAFFOLD_ENTRIES,
      providerInstanceId: connectDialog.providerInstanceId,
    });
  }, [connectDialog]);

  const resolvedSelectedAuthMethodId = resolveAutoSelectedAuthMethod({
    methods: selectedAuthMethods,
    selectedAuthMethodId,
  });
  const selectedAuthMethodValue = resolvedSelectedAuthMethodId ?? "";
  const connectState = canStartConnection({
    methods: selectedAuthMethods,
    selectedAuthMethodId: resolvedSelectedAuthMethodId,
  });

  return (
    <div className="gap-4 flex flex-col">
      <div className="gap-3 flex flex-col">
        {PROVIDER_SCAFFOLD_ENTRIES.map((provider) => {
          const status = deriveProviderStatusFromConnections({
            connections: provider.connections,
          });
          return (
            <div className="border rounded-md p-3" key={provider.providerInstanceId}>
              <div className="items-center justify-between gap-2 flex">
                <div className="gap-1 flex flex-col">
                  <div className="items-center gap-2 flex">
                    <ProviderNameBadge displayName={provider.displayName} />
                    <p className="text-sm font-medium">{provider.displayName}</p>
                    <ProviderStatusBadge status={status} />
                  </div>
                  <p className="text-muted-foreground text-xs">{provider.description}</p>
                </div>
                <div className="items-center gap-2 flex">
                  <Button
                    onClick={() => {
                      setConnectDialog({
                        providerInstanceId: provider.providerInstanceId,
                        providerDisplayName: provider.displayName,
                      });
                      setSelectedAuthMethodId(null);
                    }}
                    type="button"
                    variant={status === "Connected" ? "outline" : "default"}
                  >
                    {status === "Connected" ? "Manage" : "Connect"}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setConnectDialog(null);
            setSelectedAuthMethodId(null);
          }
        }}
        open={connectDialog !== null}
      >
        {connectDialog ? (
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Connect {connectDialog.providerDisplayName}?</DialogTitle>
              <DialogDescription>
                {selectedAuthMethods.length > 1
                  ? "Select an authentication method below to continue."
                  : "You will be redirected from Mistle to complete authentication."}
              </DialogDescription>
            </DialogHeader>
            {selectedAuthMethods.length > 1 ? (
              <RadioGroup
                className="gap-2"
                name={`connect-auth-method-${connectDialog.providerInstanceId}`}
                onValueChange={(nextValue) => setSelectedAuthMethodId(nextValue)}
                value={selectedAuthMethodValue}
              >
                {selectedAuthMethods.map((method) => {
                  const itemId = `connect-auth-method-${connectDialog.providerInstanceId}-${method.id}`;

                  return (
                    <label
                      className="inline-flex items-center gap-2 text-sm"
                      htmlFor={itemId}
                      key={method.id}
                    >
                      <RadioGroupItem aria-label={method.label} id={itemId} value={method.id} />
                      <span>{method.label}</span>
                    </label>
                  );
                })}
              </RadioGroup>
            ) : null}
            {selectedAuthMethods.length > 1 ? (
              <p className="text-muted-foreground text-sm">
                You will be redirected from Mistle to complete authentication.
              </p>
            ) : null}
            {connectState.errorMessage && selectedAuthMethods.length === 0 ? (
              <p className="text-destructive text-sm">{connectState.errorMessage}</p>
            ) : null}
            <DialogFooter>
              <Button
                onClick={() => {
                  setConnectDialog(null);
                  setSelectedAuthMethodId(null);
                }}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={!connectState.canStart}
                onClick={() => {
                  if (resolvedSelectedAuthMethodId === null) {
                    throw new Error("No auth method selected for connect flow.");
                  }

                  setConnectDialog(null);
                  setSelectedAuthMethodId(null);
                }}
                type="button"
              >
                Continue
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function ProviderNameBadge(props: { displayName: string }): React.JSX.Element {
  const firstCharacter = props.displayName.slice(0, 1).toUpperCase();
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-muted-foreground text-[10px] font-semibold">
      {firstCharacter}
    </span>
  );
}

function ProviderStatusBadge(props: { status: ProviderCatalogEntry["status"] }): React.JSX.Element {
  if (props.status === "Connected") {
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600/90" variant="secondary">
        {props.status}
      </Badge>
    );
  }

  if (props.status === "Error") {
    return <Badge variant="destructive">{props.status}</Badge>;
  }

  return <Badge variant="outline">{props.status}</Badge>;
}
