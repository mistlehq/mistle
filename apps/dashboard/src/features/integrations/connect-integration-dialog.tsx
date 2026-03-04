import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  RadioGroup,
  RadioGroupItem,
} from "@mistle/ui";

export type ConnectMethodId = "api-key" | "oauth";
export const ConnectMethodIds: {
  API_KEY: ConnectMethodId;
  OAUTH: ConnectMethodId;
} = {
  API_KEY: "api-key",
  OAUTH: "oauth",
};

export type ConnectDialogState = {
  displayName: string;
  targetKey: string;
  methods: readonly ConnectMethodId[];
};

type ConnectIntegrationDialogProps = {
  apiKeyValue: string;
  connectError: string | null;
  connectMethodId: ConnectMethodId;
  dialog: ConnectDialogState | null;
  pending: boolean;
  onApiKeyChange: (value: string) => void;
  onClose: () => void;
  onMethodChange: (methodId: ConnectMethodId) => void;
  onSubmit: () => void;
};

function formatConnectMethodLabel(methodId: ConnectMethodId): string {
  if (methodId === ConnectMethodIds.API_KEY) {
    return "API key";
  }
  return "OAuth";
}

export function ConnectIntegrationDialog(props: ConnectIntegrationDialogProps) {
  const dialog = props.dialog;

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          props.onClose();
        }
      }}
      open={dialog !== null}
    >
      {dialog ? (
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Connect {dialog.displayName}?</DialogTitle>
            <DialogDescription>
              Choose an authentication method to create the integration connection.
            </DialogDescription>
          </DialogHeader>

          <RadioGroup
            className="gap-2"
            name={`connect-auth-method-${dialog.targetKey}`}
            onValueChange={(nextValue) => {
              if (nextValue === ConnectMethodIds.API_KEY || nextValue === ConnectMethodIds.OAUTH) {
                props.onMethodChange(nextValue);
              }
            }}
            value={props.connectMethodId}
          >
            {dialog.methods.map((methodId) => (
              <label
                className="inline-flex items-center gap-2 text-sm"
                htmlFor={`connect-auth-method-${dialog.targetKey}-${methodId}`}
                key={methodId}
              >
                <RadioGroupItem
                  aria-label={formatConnectMethodLabel(methodId)}
                  id={`connect-auth-method-${dialog.targetKey}-${methodId}`}
                  value={methodId}
                />
                <span>{formatConnectMethodLabel(methodId)}</span>
              </label>
            ))}
          </RadioGroup>

          {props.connectMethodId === ConnectMethodIds.API_KEY ? (
            <div className="gap-2 flex flex-col">
              <p className="text-sm font-medium">API key</p>
              <Input
                autoComplete="off"
                data-1p-ignore="true"
                onChange={(event) => {
                  props.onApiKeyChange(event.currentTarget.value);
                }}
                placeholder="sk-..."
                type="password"
                value={props.apiKeyValue}
              />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Continue to generate an OAuth authorization URL and redirect.
            </p>
          )}

          {props.connectError ? (
            <p className="text-destructive text-sm">{props.connectError}</p>
          ) : null}

          <DialogFooter>
            <Button onClick={props.onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={props.pending} onClick={props.onSubmit} type="button">
              {props.connectMethodId === ConnectMethodIds.API_KEY
                ? "Create connection"
                : "Continue with OAuth"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
