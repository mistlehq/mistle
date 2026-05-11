import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  Button,
  CopyableValue,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextLink,
} from "@mistle/ui";
import type { IChangeEvent } from "@rjsf/core";
import type { RJSFSchema } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";

import { ConfiguredSecretField, type SavingFieldState } from "../forms/configured-secret-field.js";
import { SchemaFormWithoutSubmit } from "../forms/schema-form.js";
import type { ConnectionMethodFormUiModel } from "../pages/use-integration-connection-editor-state-helpers.js";
import { FormPageActionBar, FormPageSection, FormPageStack } from "../shared/form-page.js";
import { SectionHeader } from "../shared/section-header.js";
import { resolveSelectedConnectionMethod } from "./integration-connection-method-selection.js";
import type { IntegrationConnectionMethod as ServiceIntegrationConnectionMethod } from "./integrations-service-shared.js";

export type IntegrationConnectionMethod = ServiceIntegrationConnectionMethod;
export type IntegrationConnectionMethodId = IntegrationConnectionMethod["id"];
export { IntegrationConnectionMethodIds };

const IdleSecretFieldState: SavingFieldState = {
  status: "idle",
  errorMessage: null,
};

type CreateIntegrationConnectionEditorState = {
  methods: readonly IntegrationConnectionMethod[];
  mode: "create";
  targetConfig: Record<string, unknown>;
  targetDisplayName: string;
  targetFamilyId: string;
  targetKey: string;
  targetVariantId: string;
};

type UpdateIntegrationConnectionEditorState = {
  connectionConfig?: Record<string, unknown>;
  connectionId: string;
  configuredSecretNames?: readonly string[];
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

export type IntegrationConnectionEditorState =
  | CreateIntegrationConnectionEditorState
  | UpdateIntegrationConnectionEditorState;

export type IntegrationConnectionDeviceAuthorizationPendingState = {
  targetKey: string;
  attemptId: string;
  verificationUrl: string;
  userCode: string;
  expiresAt?: string;
  pollAfterMs?: number;
  method: Extract<IntegrationConnectionMethod, { kind: "device-authorization" }>;
};

type IntegrationConnectionEditorProps = {
  closeDisabled?: boolean;
  configForm: ConnectionMethodFormUiModel;
  configValue: Record<string, unknown>;
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
  connectError: string | null;
  deviceAuthorizationPending?: IntegrationConnectionDeviceAuthorizationPendingState | null;
  editor: IntegrationConnectionEditorState;
  hasChanges: boolean;
  isConnectionDisplayNameChanged: boolean;
  methodId: IntegrationConnectionMethodId;
  onClose: () => void;
  onConfigChange: (value: Record<string, unknown>) => void;
  onConnectionDisplayNameChange: (value: string) => void;
  onMethodChange: (methodId: IntegrationConnectionMethodId) => void;
  onSecretChange: (name: string, value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  changedSecretNames: readonly string[];
  secrets: Record<string, string>;
};

function formatIntegrationConnectionMethodLabel(method: IntegrationConnectionMethod): string {
  return method.label;
}

function resolveCreateSubmitLabel(method: IntegrationConnectionMethod | null): string {
  if (method?.kind === "redirect" || method?.kind === "device-authorization") {
    return method.ui.create.submitLabel;
  }

  return "Add connection";
}

function renderAuthCreateHelper(method: IntegrationConnectionMethod | null) {
  if (method?.kind !== "redirect") {
    return null;
  }

  return <Notice>{method.ui.create.helperText}</Notice>;
}

export function formatDeviceAuthorizationExpiry(input: { expiresAt: string; now: Date }): string {
  const expiresAtDate = new Date(input.expiresAt);
  const formattedExpiresAt = expiresAtDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const remainingMs = expiresAtDate.getTime() - input.now.getTime();

  if (remainingMs <= 0) {
    return `This code expired at ${formattedExpiresAt}.`;
  }

  if (remainingMs < 60_000) {
    return `This code expires in less than 1 minute at ${formattedExpiresAt}.`;
  }

  const remainingMinutes = Math.ceil(remainingMs / 60_000);
  const minutesLabel = remainingMinutes === 1 ? "minute" : "minutes";
  return `This code expires in ${remainingMinutes} ${minutesLabel} at ${formattedExpiresAt}.`;
}

function shouldSkipCreateTimeSetupFields(input: {
  editor: IntegrationConnectionEditorState;
  method: IntegrationConnectionMethod | null;
}): boolean {
  return (
    input.editor.mode === "create" &&
    input.method?.kind === "form" &&
    input.method.createBehavior === "draft-then-setup"
  );
}

function renderDeviceAuthorizationPending(input: {
  pending: IntegrationConnectionDeviceAuthorizationPendingState;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader
        description={
          input.pending.method.ui.pending?.description ??
          "Open the link below and enter the code to approve access."
        }
        title={input.pending.method.ui.pending?.title ?? "Approve the connection"}
      />

      <Field contentWidth="fill" orientation="vertical">
        <FieldHeader>
          <FieldLabel>Verification URL</FieldLabel>
        </FieldHeader>
        <FieldContent>
          <TextLink
            className="break-all text-sm"
            href={input.pending.verificationUrl}
            opensInNewWindow
          >
            {input.pending.verificationUrl}
          </TextLink>
        </FieldContent>
      </Field>

      <CopyableValue label="Code" value={input.pending.userCode} />

      {input.pending.expiresAt ? (
        <p className="text-muted-foreground text-sm">
          {formatDeviceAuthorizationExpiry({
            expiresAt: input.pending.expiresAt,
            now: new Date(),
          })}
        </p>
      ) : null}
    </div>
  );
}

function renderConnectionEditorFields(props: IntegrationConnectionEditorProps) {
  const editor = props.editor;
  const isUpdateMode = editor.mode === "update";
  const selectedMethod = resolveSelectedConnectionMethod({
    editor,
    methodId: props.methodId,
  });
  const showMethodPicker = editor.mode === "create" && editor.methods.length > 1;
  const skipCreateTimeSetupFields = shouldSkipCreateTimeSetupFields({
    editor,
    method: selectedMethod,
  });
  const showsConfigForm =
    skipCreateTimeSetupFields === false &&
    props.configForm.mode === "form" &&
    props.configForm.visiblePropertyKeys.length > 0;
  const showsSecretInput = skipCreateTimeSetupFields === false && selectedMethod?.kind === "form";
  const selectedMethodLabel = selectedMethod
    ? formatIntegrationConnectionMethodLabel(selectedMethod)
    : undefined;

  return (
    <>
      <Field contentWidth="fill" orientation="vertical">
        <FieldHeader>
          <FieldLabel htmlFor={`connection-display-name-${editor.targetKey}`}>Name</FieldLabel>
        </FieldHeader>
        <FieldContent>
          <Input
            autoComplete="off"
            id={`connection-display-name-${editor.targetKey}`}
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
            <FieldLabel htmlFor={`connect-auth-method-${editor.targetKey}`}>
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
              <SelectTrigger className="w-full" id={`connect-auth-method-${editor.targetKey}`}>
                <SelectValue placeholder="Select authentication method">
                  {selectedMethodLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {editor.methods.map((method) => (
                  <SelectItem key={method.id} value={method.id}>
                    {formatIntegrationConnectionMethodLabel(method)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldContent>
        </Field>
      ) : null}

      {showsConfigForm && props.configForm.mode === "form" ? (
        <SchemaFormWithoutSubmit
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
          {selectedMethod.secretFields.map((secretField) => {
            const fieldId = `connection-secret-${editor.targetKey}-${secretField.name}`;
            const configured =
              isUpdateMode && (editor.configuredSecretNames?.includes(secretField.name) ?? false);
            const secretChanged = props.changedSecretNames.includes(secretField.name);

            return (
              <ConfiguredSecretField
                autoComplete="off"
                confirmReplacement={false}
                configured={configured}
                fieldState={IdleSecretFieldState}
                id={fieldId}
                key={secretField.name}
                label={secretField.label}
                onePasswordIgnore
                onChange={(nextValue) => {
                  props.onSecretChange(secretField.name, nextValue);
                }}
                placeholder={secretField.placeholder ?? `Enter ${secretField.label.toLowerCase()}`}
                required={secretField.optional !== true}
                secretLabel={secretField.label.toLowerCase()}
                value={props.secrets[secretField.name] ?? ""}
                {...(secretField.description === undefined
                  ? {}
                  : { description: secretField.description })}
                replacementStaged={isUpdateMode && secretChanged}
                {...(secretField.inputType === "textarea" ? { multiline: true, rows: 8 } : {})}
                {...(secretField.inputType === "password"
                  ? { type: "password" }
                  : secretField.inputType === "text"
                    ? { type: "text" }
                    : {})}
              />
            );
          })}
        </>
      ) : props.configForm.mode === "unsupported" ? (
        <p className="text-destructive text-sm">{props.configForm.message}</p>
      ) : !isUpdateMode ? (
        renderAuthCreateHelper(selectedMethod)
      ) : (
        <p className="text-muted-foreground text-sm">Save to update this connection.</p>
      )}
    </>
  );
}

export function IntegrationConnectionEditorPage(
  props: IntegrationConnectionEditorProps,
): React.JSX.Element {
  const editor = props.editor;
  const isUpdateMode = editor.mode === "update";
  const closeDisabled = props.closeDisabled ?? false;
  return (
    <FormPageStack>
      <FormPageSection>
        <div className="flex flex-col gap-6 p-4">
          {props.deviceAuthorizationPending
            ? renderDeviceAuthorizationPending({
                pending: props.deviceAuthorizationPending,
              })
            : renderConnectionEditorFields({
                ...props,
                editor,
              })}

          {props.connectError ? (
            <p className="text-destructive text-sm">{props.connectError}</p>
          ) : null}

          <FormPageActionBar>
            <Button
              disabled={closeDisabled}
              onClick={props.onClose}
              type="button"
              variant="outline"
            >
              {props.deviceAuthorizationPending ? "Cancel authorization" : "Cancel"}
            </Button>
            {props.deviceAuthorizationPending ? null : (
              <Button
                disabled={props.pending || (isUpdateMode && !props.hasChanges)}
                onClick={props.onSubmit}
                type="button"
              >
                {isUpdateMode
                  ? "Save"
                  : resolveCreateSubmitLabel(
                      resolveSelectedConnectionMethod({
                        editor,
                        methodId: props.methodId,
                      }),
                    )}
              </Button>
            )}
          </FormPageActionBar>
        </div>
      </FormPageSection>
    </FormPageStack>
  );
}
