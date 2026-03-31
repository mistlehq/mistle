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

export type IntegrationConnectionMethodId = string;
export const IntegrationConnectionMethodIds: {
  API_KEY: IntegrationConnectionMethodId;
  OAUTH2_AUTHORIZATION_CODE: IntegrationConnectionMethodId;
  GITHUB_APP_INSTALLATION: IntegrationConnectionMethodId;
} = {
  API_KEY: "api-key",
  OAUTH2_AUTHORIZATION_CODE: "oauth2-authorization-code",
  GITHUB_APP_INSTALLATION: "github-app-installation",
};

export type IntegrationConnectionMethodSecretField = {
  name: string;
  label: string;
  placeholder?: string | undefined;
  description?: string | undefined;
  inputType: "password" | "text";
};

type IntegrationFormConnectionMethod = {
  id: IntegrationConnectionMethodId;
  label: string;
  kind: "form";
  secretFields: IntegrationConnectionMethodSecretField[];
};

type IntegrationRedirectConnectionMethod = {
  id: IntegrationConnectionMethodId;
  label: string;
  kind: "redirect";
};

export type IntegrationConnectionMethod =
  | IntegrationFormConnectionMethod
  | IntegrationRedirectConnectionMethod;

type CreateIntegrationConnectionDialogState = {
  displayName: string;
  targetKey: string;
  methods: readonly IntegrationConnectionMethod[];
  mode: "create";
};

type UpdateIntegrationConnectionDialogState = {
  connectionId: string;
  currentMethod: IntegrationConnectionMethod;
  displayName: string;
  initialConnectionDisplayName?: string;
  mode: "update";
  targetKey: string;
};

export type IntegrationConnectionDialogState =
  | CreateIntegrationConnectionDialogState
  | UpdateIntegrationConnectionDialogState;

type IntegrationConnectionDialogProps = {
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
  connectError: string | null;
  connectMethodId: IntegrationConnectionMethodId;
  dialog: IntegrationConnectionDialogState | null;
  hasChanges: boolean;
  isSecretsChanged: boolean;
  isConnectionDisplayNameChanged: boolean;
  pending: boolean;
  onConnectionDisplayNameChange: (value: string) => void;
  onClose: () => void;
  onMethodChange: (methodId: IntegrationConnectionMethodId) => void;
  onSecretChange: (name: string, value: string) => void;
  onSubmit: () => void;
  secrets: Record<string, string>;
};

function formatIntegrationConnectionMethodLabel(method: IntegrationConnectionMethod): string {
  return method.label;
}

function resolveSelectedMethod(
  dialog: IntegrationConnectionDialogState,
  connectMethodId: IntegrationConnectionMethodId,
): IntegrationConnectionMethod {
  if (dialog.mode === "update") {
    return dialog.currentMethod;
  }

  const selectedMethod = dialog.methods.find((method) => method.id === connectMethodId);
  if (selectedMethod === undefined) {
    throw new Error(
      `Connection method '${connectMethodId}' is not defined for target '${dialog.targetKey}'.`,
    );
  }

  return selectedMethod;
}

export function IntegrationConnectionDialog(props: IntegrationConnectionDialogProps) {
  const dialog = props.dialog;
  const isUpdateMode = dialog?.mode === "update";
  const showMethodPicker = dialog?.mode === "create" && dialog.methods.length > 1;
  const selectedMethod =
    dialog === null ? null : resolveSelectedMethod(dialog, props.connectMethodId);

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
                  props.onMethodChange(nextValue);
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

          {selectedMethod?.kind === "form" ? (
            <div className="gap-2 flex flex-col">
              {selectedMethod.secretFields.map((secretField) => (
                <div className="gap-2 flex flex-col" key={secretField.name}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{secretField.label}</p>
                    {isUpdateMode && props.isSecretsChanged ? (
                      <span className="text-muted-foreground text-xs">Will update</span>
                    ) : null}
                  </div>
                  {secretField.description ? (
                    <p className="text-muted-foreground text-sm">{secretField.description}</p>
                  ) : null}
                  <Input
                    autoComplete="off"
                    data-1p-ignore="true"
                    onChange={(event) => {
                      props.onSecretChange(secretField.name, event.currentTarget.value);
                    }}
                    placeholder={
                      isUpdateMode
                        ? `Leave blank to keep existing ${secretField.label.toLowerCase()}`
                        : (secretField.placeholder ?? `Enter ${secretField.label.toLowerCase()}`)
                    }
                    type={secretField.inputType}
                    value={props.secrets[secretField.name] ?? ""}
                  />
                </div>
              ))}
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
                : selectedMethod?.kind === "form"
                  ? "Create connection"
                  : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
