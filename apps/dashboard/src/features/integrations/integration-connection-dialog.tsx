import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";
import type { IChangeEvent } from "@rjsf/core";
import type { RJSFSchema } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";

import { IntegrationFormWithoutSubmit } from "../forms/integration-form-theme.js";
import type { ConnectionMethodFormUiModel } from "../pages/use-integration-connection-dialog-state-helpers.js";
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

function resolveCreateSubmitLabel(method: IntegrationConnectionMethod | null): string {
  if (method?.kind === "redirect") {
    return method.ui.create.submitLabel;
  }

  return "Create connection";
}

function renderRedirectCreateHelper(method: IntegrationConnectionMethod | null) {
  if (method?.kind !== "redirect") {
    return null;
  }

  return <Notice>{method.ui.create.helperText}</Notice>;
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
  const selectedMethodLabel = selectedMethod
    ? formatIntegrationConnectionMethodLabel(selectedMethod)
    : undefined;

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

          <Field contentWidth="fill" orientation="vertical">
            <FieldHeader>
              <FieldLabel htmlFor={`connection-display-name-${dialog.targetKey}`}>Name</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <Input
                autoComplete="off"
                id={`connection-display-name-${dialog.targetKey}`}
                onChange={(event) => {
                  props.onConnectionDisplayNameChange(event.currentTarget.value);
                }}
                placeholder={props.connectionDisplayNamePlaceholder}
                type="text"
                value={props.connectionDisplayNameValue}
              />
            </FieldContent>
          </Field>

          {showMethodPicker ? (
            <Field contentWidth="fill" orientation="vertical">
              <FieldHeader>
                <FieldLabel htmlFor={`connect-auth-method-${dialog.targetKey}`}>
                  Authentication method
                </FieldLabel>
              </FieldHeader>
              <FieldContent>
                <Select
                  onValueChange={(nextValue) => {
                    props.onMethodChange(nextValue ?? "");
                  }}
                  value={props.methodId.length === 0 ? "" : props.methodId}
                >
                  <SelectTrigger className="w-full" id={`connect-auth-method-${dialog.targetKey}`}>
                    <SelectValue placeholder="Select authentication method">
                      {selectedMethodLabel}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {dialog.methods.map((method) => (
                      <SelectItem key={method.id} value={method.id}>
                        {formatIntegrationConnectionMethodLabel(method)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>
          ) : null}

          {props.configForm.mode === "form" && props.configForm.visiblePropertyKeys.length > 0 ? (
            <IntegrationFormWithoutSubmit
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
              uiSchema={props.configForm.uiSchema}
              validator={validator}
            />
          ) : null}

          {showsSecretInput && selectedMethod !== null ? (
            <>
              {selectedMethod.secretFields.map((secretField) => (
                <Field contentWidth="fill" key={secretField.name} orientation="vertical">
                  <FieldHeader>
                    <div className="flex items-center justify-between gap-3">
                      <FieldLabel
                        htmlFor={`connection-secret-${dialog.targetKey}-${secretField.name}`}
                      >
                        {secretField.label}
                      </FieldLabel>
                      {isUpdateMode && props.isSecretChanged ? (
                        <span className="text-muted-foreground text-xs">Will update</span>
                      ) : null}
                    </div>
                    {secretField.description ? (
                      <FieldDescription>{secretField.description}</FieldDescription>
                    ) : null}
                  </FieldHeader>
                  <FieldContent>
                    <Input
                      autoComplete="off"
                      data-1p-ignore="true"
                      id={`connection-secret-${dialog.targetKey}-${secretField.name}`}
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
                  </FieldContent>
                </Field>
              ))}
            </>
          ) : props.configForm.mode === "unsupported" ? (
            <p className="text-destructive text-sm">{props.configForm.message}</p>
          ) : !isUpdateMode ? (
            renderRedirectCreateHelper(selectedMethod)
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
              {isUpdateMode ? "Save" : resolveCreateSubmitLabel(selectedMethod)}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
