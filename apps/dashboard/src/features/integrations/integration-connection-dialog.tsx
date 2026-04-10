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
  Textarea,
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

export type IntegrationConnectionDeviceAuthorizationPendingState = {
  targetKey: string;
  attemptId: string;
  verificationUrl: string;
  userCode: string;
  expiresAt?: string;
  pollAfterMs?: number;
  method: Extract<IntegrationConnectionMethod, { kind: "device-authorization" }>;
};

type IntegrationConnectionDialogProps = {
  configForm: ConnectionMethodFormUiModel;
  configValue: Record<string, unknown>;
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
  connectError: string | null;
  deviceAuthorizationPending?: IntegrationConnectionDeviceAuthorizationPendingState | null;
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
  if (method?.kind === "redirect" || method?.kind === "device-authorization") {
    return method.ui.create.submitLabel;
  }

  return "Create connection";
}

function renderAuthCreateHelper(method: IntegrationConnectionMethod | null) {
  if (method?.kind !== "redirect" && method?.kind !== "device-authorization") {
    return null;
  }

  return <Notice>{method.ui.create.helperText}</Notice>;
}

function renderDeviceAuthorizationPending(input: {
  pending: IntegrationConnectionDeviceAuthorizationPendingState;
}) {
  return (
    <div className="space-y-4">
      <Notice>
        <div className="space-y-1">
          <p className="font-medium">
            {input.pending.method.ui.pending?.title ?? "Approve The Connection"}
          </p>
          <p>
            {input.pending.method.ui.pending?.description ??
              "Open the verification link, enter the device code, and approve access."}
          </p>
        </div>
      </Notice>

      <Field contentWidth="fill" orientation="vertical">
        <FieldHeader>
          <FieldLabel>Verification URL</FieldLabel>
        </FieldHeader>
        <FieldContent>
          <a
            className="text-primary break-all text-sm underline underline-offset-2"
            href={input.pending.verificationUrl}
            rel="noreferrer"
            target="_blank"
          >
            {input.pending.verificationUrl}
          </a>
        </FieldContent>
      </Field>

      <Field contentWidth="fill" orientation="vertical">
        <FieldHeader>
          <FieldLabel>Code</FieldLabel>
        </FieldHeader>
        <FieldContent>
          <Input readOnly type="text" value={input.pending.userCode} />
        </FieldContent>
      </Field>

      {input.pending.expiresAt ? (
        <p className="text-muted-foreground text-sm">
          This code expires at {new Date(input.pending.expiresAt).toLocaleString()}.
        </p>
      ) : null}
    </div>
  );
}

export function IntegrationConnectionDialog(props: IntegrationConnectionDialogProps) {
  const dialog = props.dialog;
  const isUpdateMode = dialog?.mode === "update";
  const isDeviceAuthorizationPending = props.deviceAuthorizationPending != null;
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
        <DialogContent
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl"
          showCloseButton={false}
        >
          <DialogHeader variant="sectioned">
            <DialogTitle>
              {isDeviceAuthorizationPending
                ? `Finish ${dialog.targetDisplayName} Connection`
                : isUpdateMode
                  ? "Edit Connection"
                  : `Add ${dialog.targetDisplayName} Connection`}
            </DialogTitle>
          </DialogHeader>

          {props.deviceAuthorizationPending ? (
            renderDeviceAuthorizationPending({
              pending: props.deviceAuthorizationPending,
            })
          ) : (
            <>
              <Field contentWidth="fill" orientation="vertical">
                <FieldHeader>
                  <FieldLabel htmlFor={`connection-display-name-${dialog.targetKey}`}>
                    Name
                  </FieldLabel>
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
                      <SelectTrigger
                        className="w-full"
                        id={`connect-auth-method-${dialog.targetKey}`}
                      >
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

              {props.configForm.mode === "form" &&
              props.configForm.visiblePropertyKeys.length > 0 ? (
                <IntegrationFormWithoutSubmit
                  formData={props.configValue}
                  noHtml5Validate
                  onChange={(event: IChangeEvent<Record<string, unknown>, RJSFSchema>) => {
                    const nextValue = event.formData;
                    props.onConfigChange(
                      typeof nextValue === "object" &&
                        nextValue !== null &&
                        !Array.isArray(nextValue)
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
                        {secretField.inputType === "textarea" ? (
                          <Textarea
                            autoComplete="off"
                            data-1p-ignore="true"
                            id={`connection-secret-${dialog.targetKey}-${secretField.name}`}
                            onChange={(event) => {
                              props.onSecretChange(secretField.name, event.currentTarget.value);
                            }}
                            placeholder={
                              isUpdateMode
                                ? `Leave blank to keep existing ${secretField.label.toLowerCase()}`
                                : (secretField.placeholder ??
                                  `Enter ${secretField.label.toLowerCase()}`)
                            }
                            rows={8}
                            value={props.secrets[secretField.name] ?? ""}
                          />
                        ) : (
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
                                : (secretField.placeholder ??
                                  `Enter ${secretField.label.toLowerCase()}`)
                            }
                            type={secretField.inputType}
                            value={props.secrets[secretField.name] ?? ""}
                          />
                        )}
                      </FieldContent>
                    </Field>
                  ))}
                </>
              ) : props.configForm.mode === "unsupported" ? (
                <p className="text-destructive text-sm">{props.configForm.message}</p>
              ) : !isUpdateMode ? (
                renderAuthCreateHelper(selectedMethod)
              ) : (
                <p className="text-muted-foreground text-sm">Save to update this connection.</p>
              )}
            </>
          )}

          {props.connectError ? (
            <p className="text-destructive text-sm">{props.connectError}</p>
          ) : null}

          <DialogFooter>
            <Button onClick={props.onClose} type="button" variant="outline">
              {props.deviceAuthorizationPending ? "Cancel authorization" : "Cancel"}
            </Button>
            {props.deviceAuthorizationPending ? null : (
              <Button
                disabled={props.pending || (isUpdateMode && !props.hasChanges)}
                onClick={props.onSubmit}
                type="button"
              >
                {isUpdateMode ? "Save" : resolveCreateSubmitLabel(selectedMethod)}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
