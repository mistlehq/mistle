import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Notice,
  RadioGroup,
  RadioGroupItem,
} from "@mistle/ui";
import Form, { type IChangeEvent } from "@rjsf/core";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";

import {
  IntegrationFormTemplates,
  IntegrationFormWidgets,
} from "../forms/integration-form-theme.js";
import type { IntegrationConnectionMethod as ServiceIntegrationConnectionMethod } from "./integrations-service-shared.js";

export type IntegrationConnectionMethod = ServiceIntegrationConnectionMethod;
export type IntegrationConnectionMethodId = IntegrationConnectionMethod["id"];
export { IntegrationConnectionMethodIds };

type CreateIntegrationConnectionDialogState = {
  methods: readonly IntegrationConnectionMethod[];
  mode: "create";
  targetConfig: Record<string, unknown>;
  targetDisplayName: string;
  targetFamilyId: string;
  targetKey: string;
  targetVariantId: string;
};

type UpdateIntegrationConnectionDialogState = {
  connectionConfig?: Record<string, unknown>;
  connectionId: string;
  currentConnectionConfig: Record<string, unknown>;
  currentMethod: IntegrationConnectionMethod;
  displayName?: string;
  initialConnectionDisplayName?: string;
  mode: "update";
  targetConfig: Record<string, unknown>;
  targetDisplayName: string;
  targetFamilyId: string;
  targetKey: string;
  targetVariantId: string;
};

export type IntegrationConnectionDialogState =
  | CreateIntegrationConnectionDialogState
  | UpdateIntegrationConnectionDialogState;

type ConnectionMethodFormUiModel =
  | {
      mode: "none";
    }
  | {
      mode: "form";
      schema: RJSFSchema;
      uiSchema: UiSchema<Record<string, unknown>, RJSFSchema>;
      value: Record<string, unknown>;
      visiblePropertyKeys: readonly string[];
    }
  | {
      mode: "unsupported";
      message: string;
    };

type IntegrationConnectionDialogProps = {
  configForm: ConnectionMethodFormUiModel;
  configValue: Record<string, unknown>;
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
  connectError: string | null;
  dialog: IntegrationConnectionDialogState | null;
  hasChanges: boolean;
  isConnectionDisplayNameChanged: boolean;
  isSecretChanged: boolean;
  methodId: IntegrationConnectionMethodId;
  onClose: () => void;
  onConfigChange: (value: Record<string, unknown>) => void;
  onConnectionDisplayNameChange: (value: string) => void;
  onMethodChange: (methodId: IntegrationConnectionMethodId) => void;
  onSecretChange: (name: string, value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  secrets: Record<string, string>;
};

function HiddenSubmitButton(): null {
  return null;
}

const DialogFormTemplates = {
  ...IntegrationFormTemplates,
  ButtonTemplates: {
    SubmitButton: HiddenSubmitButton,
  },
};

function formatIntegrationConnectionMethodLabel(method: IntegrationConnectionMethod): string {
  return method.label;
}

function resolveSelectedMethod(input: {
  dialog: IntegrationConnectionDialogState;
  methodId: IntegrationConnectionMethodId;
}): IntegrationConnectionMethod | null {
  if (input.dialog.mode === "update") {
    return input.dialog.currentMethod.id === input.methodId ? input.dialog.currentMethod : null;
  }

  return input.dialog.methods.find((method) => method.id === input.methodId) ?? null;
}

export function IntegrationConnectionDialog(props: IntegrationConnectionDialogProps) {
  const dialog = props.dialog;
  const isUpdateMode = dialog?.mode === "update";
  const showMethodPicker = dialog?.mode === "create" && dialog.methods.length > 1;
  const selectedMethod =
    dialog === null
      ? null
      : resolveSelectedMethod({
          dialog,
          methodId: props.methodId,
        });
  const showsSecretInput = selectedMethod?.kind === "form";

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
              {isUpdateMode ? "Edit Connection" : `Add ${dialog.targetDisplayName} Connection`}
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
                value={props.methodId}
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

          {props.configForm.mode === "form" && props.configForm.visiblePropertyKeys.length > 0 ? (
            <div className="gap-2 flex flex-col">
              <p className="text-sm font-medium">Configuration</p>
              <Form
                formData={props.configValue}
                noHtml5Validate
                onChange={(event: IChangeEvent<Record<string, unknown>, RJSFSchema>) => {
                  const nextValue = event.formData;
                  props.onConfigChange(
                    typeof nextValue === "object" && nextValue !== null && !Array.isArray(nextValue)
                      ? nextValue
                      : {},
                  );
                }}
                schema={props.configForm.schema}
                showErrorList={false}
                templates={DialogFormTemplates}
                uiSchema={props.configForm.uiSchema}
                validator={validator}
                widgets={IntegrationFormWidgets}
              />
            </div>
          ) : null}

          {showsSecretInput && selectedMethod !== null ? (
            <div className="gap-2 flex flex-col">
              {selectedMethod.secretFields.map((secretField) => (
                <div className="gap-2 flex flex-col" key={secretField.name}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{secretField.label}</p>
                    {isUpdateMode && props.isSecretChanged ? (
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
          ) : props.configForm.mode === "unsupported" ? (
            <p className="text-destructive text-sm">{props.configForm.message}</p>
          ) : !isUpdateMode ? (
            <Notice>Continue to start the connection flow.</Notice>
          ) : (
            <p className="text-muted-foreground text-sm">Save to update this connection.</p>
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
