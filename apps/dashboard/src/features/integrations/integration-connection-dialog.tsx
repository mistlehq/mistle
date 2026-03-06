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

export type IntegrationConnectionMethodId = "api-key" | "oauth";
export const IntegrationConnectionMethodIds: {
  API_KEY: IntegrationConnectionMethodId;
  OAUTH: IntegrationConnectionMethodId;
} = {
  API_KEY: "api-key",
  OAUTH: "oauth",
};

export type IntegrationConnectionDialogState = {
  displayName: string;
  targetKey: string;
  methods: readonly IntegrationConnectionMethodId[];
  mode: "create" | "update";
  connectionId?: string;
};

type IntegrationConnectionDialogProps = {
  apiKeyValue: string;
  connectError: string | null;
  connectMethodId: IntegrationConnectionMethodId;
  dialog: IntegrationConnectionDialogState | null;
  pending: boolean;
  onApiKeyChange: (value: string) => void;
  onClose: () => void;
  onMethodChange: (methodId: IntegrationConnectionMethodId) => void;
  onSubmit: () => void;
};

function formatIntegrationConnectionMethodLabel(methodId: IntegrationConnectionMethodId): string {
  if (methodId === IntegrationConnectionMethodIds.API_KEY) {
    return "API key";
  }
  return "OAuth";
}

export function IntegrationConnectionDialog(props: IntegrationConnectionDialogProps) {
  const dialog = props.dialog;
  const isUpdateMode = dialog?.mode === "update";
  const supportsSingleMethod = dialog?.methods.length === 1;

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
            <DialogTitle>
              {isUpdateMode ? "Update API key" : `Connect ${dialog.displayName}?`}
            </DialogTitle>
            {isUpdateMode ? (
              <DialogDescription>
                Set a new API key for connection {dialog.connectionId} in {dialog.displayName}.
              </DialogDescription>
            ) : (
              <DialogDescription>
                Choose an authentication method to create the integration connection.
              </DialogDescription>
            )}
          </DialogHeader>

          {supportsSingleMethod ? null : (
            <RadioGroup
              className="gap-2"
              name={`connect-auth-method-${dialog.targetKey}`}
              onValueChange={(nextValue) => {
                if (
                  nextValue === IntegrationConnectionMethodIds.API_KEY ||
                  nextValue === IntegrationConnectionMethodIds.OAUTH
                ) {
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
                    aria-label={formatIntegrationConnectionMethodLabel(methodId)}
                    id={`connect-auth-method-${dialog.targetKey}-${methodId}`}
                    value={methodId}
                  />
                  <span>{formatIntegrationConnectionMethodLabel(methodId)}</span>
                </label>
              ))}
            </RadioGroup>
          )}

          {props.connectMethodId === IntegrationConnectionMethodIds.API_KEY ? (
            <div className="gap-2 flex flex-col">
              <p className="text-sm font-medium">API key</p>
              <Input
                autoComplete="off"
                data-1p-ignore="true"
                onChange={(event) => {
                  props.onApiKeyChange(event.currentTarget.value);
                }}
                placeholder="Enter API key"
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
              {props.connectMethodId === IntegrationConnectionMethodIds.API_KEY
                ? isUpdateMode
                  ? "Update API key"
                  : "Create connection"
                : "Continue with OAuth"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
