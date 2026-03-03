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

export type ConnectDialogState = {
  displayName: string;
  targetKey: string;
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

export function ConnectIntegrationDialog(props: ConnectIntegrationDialogProps) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          props.onClose();
        }
      }}
      open={props.dialog !== null}
    >
      {props.dialog ? (
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Connect {props.dialog.displayName}?</DialogTitle>
            <DialogDescription>
              Choose an authentication method to create the integration connection.
            </DialogDescription>
          </DialogHeader>

          <RadioGroup
            className="gap-2"
            name={`connect-auth-method-${props.dialog.targetKey}`}
            onValueChange={(nextValue) => {
              if (nextValue === "api-key" || nextValue === "oauth") {
                props.onMethodChange(nextValue);
              }
            }}
            value={props.connectMethodId}
          >
            <label
              className="inline-flex items-center gap-2 text-sm"
              htmlFor={`connect-auth-method-${props.dialog.targetKey}-api-key`}
            >
              <RadioGroupItem
                aria-label="API key"
                id={`connect-auth-method-${props.dialog.targetKey}-api-key`}
                value="api-key"
              />
              <span>API key</span>
            </label>
            <label
              className="inline-flex items-center gap-2 text-sm"
              htmlFor={`connect-auth-method-${props.dialog.targetKey}-oauth`}
            >
              <RadioGroupItem
                aria-label="OAuth"
                id={`connect-auth-method-${props.dialog.targetKey}-oauth`}
                value="oauth"
              />
              <span>OAuth</span>
            </label>
          </RadioGroup>

          {props.connectMethodId === "api-key" ? (
            <div className="gap-2 flex flex-col">
              <p className="text-sm font-medium">API key</p>
              <Input
                autoComplete="off"
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
              {props.connectMethodId === "api-key" ? "Create connection" : "Continue with OAuth"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
