import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  RadioGroup,
  RadioGroupItem,
} from "@mistle/ui";

export type IntegrationConnectionMethodId = "api-key" | "oauth2" | "github-app-installation";
export const IntegrationConnectionMethodIds: {
  API_KEY: IntegrationConnectionMethodId;
  OAUTH2: IntegrationConnectionMethodId;
  GITHUB_APP_INSTALLATION: IntegrationConnectionMethodId;
} = {
  API_KEY: "api-key",
  OAUTH2: "oauth2",
  GITHUB_APP_INSTALLATION: "github-app-installation",
};

export type IntegrationConnectionMethod = {
  id: IntegrationConnectionMethodId;
  label: string;
  kind: "api-key" | "oauth2" | "redirect";
};

type CreateIntegrationConnectionDialogState = {
  displayName: string;
  targetKey: string;
  methods: readonly IntegrationConnectionMethod[];
  mode: "create";
};

type UpdateIntegrationConnectionDialogState = {
  connectionId: string;
  currentMethodId: IntegrationConnectionMethodId;
  displayName: string;
  initialConnectionDisplayName?: string;
  mode: "update";
  targetKey: string;
};

export type IntegrationConnectionDialogState =
  | CreateIntegrationConnectionDialogState
  | UpdateIntegrationConnectionDialogState;

type IntegrationConnectionDialogProps = {
  apiKeyValue: string;
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
  connectError: string | null;
  connectMethodId: IntegrationConnectionMethodId;
  dialog: IntegrationConnectionDialogState | null;
  hasChanges: boolean;
  isApiKeyChanged: boolean;
  isConnectionDisplayNameChanged: boolean;
  pending: boolean;
  onApiKeyChange: (value: string) => void;
  onConnectionDisplayNameChange: (value: string) => void;
  onClose: () => void;
  onMethodChange: (methodId: IntegrationConnectionMethodId) => void;
  onSubmit: () => void;
};

function formatIntegrationConnectionMethodLabel(method: IntegrationConnectionMethod): string {
  return method.label;
}

export function IntegrationConnectionDialog(props: IntegrationConnectionDialogProps) {
  const dialog = props.dialog;
  const isUpdateMode = dialog?.mode === "update";
  const showMethodPicker = dialog?.mode === "create" && dialog.methods.length > 1;

  return (
    <Dialog
      isBusy={props.pending}
      isDismissible={!props.pending}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          props.onClose();
        }
      }}
      open={dialog !== null}
    >
      {dialog ? (
        <DialogContent showCloseButton={false}>
          <DialogHeader variant="sectioned">
            <DialogTitle>
              {isUpdateMode ? "Edit Connection" : `Add ${dialog.displayName} Connection`}
            </DialogTitle>
          </DialogHeader>

          <div className="gap-2 flex flex-col">
            <p className="text-sm font-medium">Name</p>
            <Input
              autoComplete="off"
              onChange={(event) => {
                props.onConnectionDisplayNameChange(event.currentTarget.value);
              }}
              placeholder={props.connectionDisplayNamePlaceholder}
              type="text"
              value={props.connectionDisplayNameValue}
            />
          </div>

          {showMethodPicker ? (
            <div className="gap-2 flex flex-col">
              <p className="text-sm font-medium">Authentication method</p>
              <RadioGroup
                className="gap-2"
                name={`connect-auth-method-${dialog.targetKey}`}
                onValueChange={(nextValue) => {
                  if (
                    nextValue === IntegrationConnectionMethodIds.API_KEY ||
                    nextValue === IntegrationConnectionMethodIds.OAUTH2 ||
                    nextValue === IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
                  ) {
                    props.onMethodChange(nextValue);
                  }
                }}
                value={props.connectMethodId}
              >
                {dialog.methods.map((method) => (
                  <label
                    className="inline-flex items-center gap-2 text-sm"
                    htmlFor={`connect-auth-method-${dialog.targetKey}-${method.id}`}
                    key={method.id}
                  >
                    <RadioGroupItem
                      aria-label={formatIntegrationConnectionMethodLabel(method)}
                      id={`connect-auth-method-${dialog.targetKey}-${method.id}`}
                      value={method.id}
                    />
                    <span>{formatIntegrationConnectionMethodLabel(method)}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          ) : null}

          {props.connectMethodId === IntegrationConnectionMethodIds.API_KEY ? (
            <div className="gap-2 flex flex-col">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">API key</p>
                {isUpdateMode && props.isApiKeyChanged ? (
                  <span className="text-muted-foreground text-xs">Will update</span>
                ) : null}
              </div>
              <Input
                autoComplete="off"
                data-1p-ignore="true"
                onChange={(event) => {
                  props.onApiKeyChange(event.currentTarget.value);
                }}
                placeholder={
                  isUpdateMode ? "Leave blank to keep existing API key" : "Enter API key"
                }
                type="password"
                value={props.apiKeyValue}
              />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {isUpdateMode
                ? "Save to update this connection name."
                : "Continue to start the connection flow."}
            </p>
          )}

          {props.connectError ? (
            <p className="text-destructive text-sm">{props.connectError}</p>
          ) : null}

          <DialogFooter>
            <Button onClick={props.onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={props.pending || (isUpdateMode && !props.hasChanges)}
              onClick={props.onSubmit}
              type="button"
            >
              {isUpdateMode
                ? "Save"
                : props.connectMethodId === IntegrationConnectionMethodIds.API_KEY
                  ? "Create connection"
                  : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
