import type { IntegrationFormConnectionMethodSetupStartForm } from "@mistle/integrations-core";
import {
  CopyableValue,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  RadioGroup,
  RadioGroupItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  TextLink,
} from "@mistle/ui";
import { useState } from "react";

import {
  ManifestJsonEditor,
  type ManifestJsonValidation,
} from "../integrations/manifest-json-editor.js";
import type { ManifestWebhookCallbackState } from "../integrations/manifest-webhook-callback-state.js";
import { FormPageSection } from "../shared/form-page.js";
import { SectionHeader } from "../shared/section-header.js";

export type IntegrationConnectionSetupMode = "manifest" | "existing-app";

export type IntegrationConnectionSetupStartFormState = {
  isFieldVisible: (fieldName: string) => boolean;
  requiredFieldsComplete: boolean;
  resolveRequiredValue: (fieldName: string) => string;
  updateValue: (fieldName: string, value: string) => void;
  values: Record<string, string>;
};

type IntegrationConnectionSetupStartFormFieldMetadata =
  IntegrationFormConnectionMethodSetupStartForm["fields"][number];

type IntegrationConnectionSetupStartFormFieldAction = NonNullable<
  IntegrationConnectionSetupStartFormFieldMetadata["actions"]
>[number];

export function useIntegrationConnectionSetupStartForm(
  form: IntegrationFormConnectionMethodSetupStartForm,
): IntegrationConnectionSetupStartFormState {
  const [values, setValues] = useState(() => createInitialSetupStartFormValues(form));

  function updateValue(fieldName: string, value: string): void {
    setValues((currentValues) => ({
      ...currentValues,
      [fieldName]: value,
    }));
  }

  function resolveRequiredValue(fieldName: string): string {
    return resolveRequiredSetupStartFormValue({
      fieldName,
      form,
      values,
    });
  }

  function isFieldVisible(fieldName: string): boolean {
    const field = form.fields.find((candidate) => candidate.name === fieldName) ?? null;
    if (field === null) {
      throw new Error(`Setup start form does not define field '${fieldName}'.`);
    }

    return isSetupStartFormFieldVisible({
      field,
      values,
    });
  }

  return {
    requiredFieldsComplete: areRequiredSetupStartFormFieldsComplete({
      form,
      values,
    }),
    isFieldVisible,
    resolveRequiredValue,
    updateValue,
    values,
  };
}

export function IntegrationConnectionSetupModeTabs(input: {
  actionErrorMessage: string | null;
  description: string;
  existingAppContent: React.ReactNode;
  footer: React.ReactNode;
  manifestContent: React.ReactNode;
  onModeChange: (mode: IntegrationConnectionSetupMode) => void;
  title: string;
  value: IntegrationConnectionSetupMode;
}): React.JSX.Element {
  return (
    <Tabs
      onValueChange={(nextValue) => {
        if (nextValue === "manifest" || nextValue === "existing-app") {
          input.onModeChange(nextValue);
        }
      }}
      value={input.value}
    >
      <SectionHeader
        className="px-1"
        description={input.description}
        size="large"
        title={input.title}
      />

      <FormPageSection>
        <div className="flex flex-col gap-6 p-4">
          <TabsList className="w-full">
            <TabsTrigger value="manifest">Create from manifest</TabsTrigger>
            <TabsTrigger value="existing-app">Use existing app</TabsTrigger>
          </TabsList>

          {input.actionErrorMessage === null ? null : (
            <Notice title="Could not continue setup" variant="alert">
              {input.actionErrorMessage}
            </Notice>
          )}

          <TabsContent value="manifest">{input.manifestContent}</TabsContent>
          <TabsContent value="existing-app">{input.existingAppContent}</TabsContent>

          {input.footer}
        </div>
      </FormPageSection>
    </Tabs>
  );
}

export function IntegrationConnectionSetupWebhookCallbackValue(input: {
  errorTitle: string;
  label: string;
  missingMessage: string;
  missingTitle: string;
  webhookCallbackState: ManifestWebhookCallbackState;
}): React.JSX.Element {
  if (input.webhookCallbackState.kind === "loading") {
    return <CopyableValue label={input.label} loading />;
  }

  if (input.webhookCallbackState.kind === "error") {
    return (
      <Notice title={input.errorTitle} variant="alert">
        {input.webhookCallbackState.message}
      </Notice>
    );
  }

  if (input.webhookCallbackState.kind === "missing") {
    return (
      <Notice title={input.missingTitle} variant="alert">
        {input.missingMessage}
      </Notice>
    );
  }

  return <CopyableValue label={input.label} value={input.webhookCallbackState.value} />;
}

export function IntegrationConnectionSetupManifestPanel(input: {
  editorId: string;
  manifestCallbackState: ManifestWebhookCallbackState;
  manifestDescription: string;
  manifestTitle: string;
  manifestValidation: ManifestJsonValidation;
  manifestValue: string;
  onManifestChange: (value: string) => void;
  onSetupStartFormValueChange: (fieldName: string, value: string) => void;
  setupStartForm: IntegrationFormConnectionMethodSetupStartForm;
  setupStartFormValues: Record<string, string>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <IntegrationConnectionSetupStartForm
        form={input.setupStartForm}
        onValueChange={input.onSetupStartFormValueChange}
        values={input.setupStartFormValues}
      />

      <IntegrationConnectionSetupManifestEditorSection
        description={input.manifestDescription}
        editorId={input.editorId}
        headingLevel="h3"
        manifestCallbackState={input.manifestCallbackState}
        manifestValidation={input.manifestValidation}
        manifestValue={input.manifestValue}
        onManifestChange={input.onManifestChange}
        title={input.manifestTitle}
      />
    </div>
  );
}

export function IntegrationConnectionSetupManifestEditorSection(input: {
  description: string;
  editorId: string;
  headingLevel?: "h2" | "h3";
  manifestCallbackState: ManifestWebhookCallbackState;
  manifestValidation: ManifestJsonValidation;
  manifestValue: string;
  onManifestChange: (value: string) => void;
  title: string;
}): React.JSX.Element {
  const titleClassName = "text-base font-medium";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        {input.headingLevel === "h3" ? (
          <h3 className={titleClassName}>{input.title}</h3>
        ) : (
          <h2 className={titleClassName}>{input.title}</h2>
        )}
        <p className="text-muted-foreground text-sm">{input.description}</p>
      </div>
      {input.manifestCallbackState.kind === "ready" ? (
        <ManifestJsonEditor
          id={input.editorId}
          onChange={input.onManifestChange}
          validation={input.manifestValidation}
          value={input.manifestValue}
        />
      ) : input.manifestCallbackState.kind === "loading" ? (
        <Notice>Loading manifest callback URLs...</Notice>
      ) : (
        <Notice title="Could not load manifest callback URLs" variant="alert">
          {input.manifestCallbackState.kind === "error"
            ? input.manifestCallbackState.message
            : "The integration webhook source is missing a callback URL."}
        </Notice>
      )}
    </div>
  );
}

function createInitialSetupStartFormValues(
  form: IntegrationFormConnectionMethodSetupStartForm,
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const field of form.fields) {
    values[field.name] = "";
  }

  return values;
}

function normalizeSetupStartFormValue(value: string | undefined): string {
  return value?.trim() ?? "";
}

function areRequiredSetupStartFormFieldsComplete(input: {
  form: IntegrationFormConnectionMethodSetupStartForm;
  values: Record<string, string>;
}): boolean {
  return input.form.fields.every(
    (field) =>
      !isSetupStartFormFieldVisible({ field, values: input.values }) ||
      field.required !== true ||
      normalizeSetupStartFormValue(input.values[field.name]).length > 0,
  );
}

function resolveRequiredSetupStartFormValue(input: {
  fieldName: string;
  form: IntegrationFormConnectionMethodSetupStartForm;
  values: Record<string, string>;
}): string {
  const field = input.form.fields.find((candidate) => candidate.name === input.fieldName) ?? null;

  if (field === null) {
    throw new Error(`Setup start form does not define required field '${input.fieldName}'.`);
  }

  const value = normalizeSetupStartFormValue(input.values[field.name]);
  if (value.length === 0) {
    throw new Error(`Setup start form field '${input.fieldName}' is required.`);
  }

  return value;
}

function isSetupStartFormFieldVisible(input: {
  field: IntegrationFormConnectionMethodSetupStartForm["fields"][number];
  values: Record<string, string>;
}): boolean {
  if (input.field.visibleWhen === undefined) {
    return true;
  }

  return input.values[input.field.visibleWhen.field] === input.field.visibleWhen.value;
}

function IntegrationConnectionSetupStartForm(input: {
  form: IntegrationFormConnectionMethodSetupStartForm;
  values: Record<string, string>;
  onValueChange: (fieldName: string, value: string) => void;
}): React.JSX.Element {
  return (
    <>
      {input.form.fields
        .filter((field) => isSetupStartFormFieldVisible({ field, values: input.values }))
        .map((field) => (
          <IntegrationConnectionSetupStartFormField
            field={field}
            key={field.name}
            onValueChange={input.onValueChange}
            value={input.values[field.name] ?? ""}
          />
        ))}
    </>
  );
}

function IntegrationConnectionSetupStartFormField(input: {
  field: IntegrationConnectionSetupStartFormFieldMetadata;
  value: string;
  onValueChange: (fieldName: string, value: string) => void;
}): React.JSX.Element {
  const inputId = `integration-setup-start-form-${input.field.name}`;
  const fieldDescriptionId = `${inputId}-description`;
  const hasDescription = input.field.description !== undefined || input.field.actions !== undefined;

  return (
    <Field>
      <FieldHeader>
        <FieldLabel htmlFor={inputId} required={input.field.required === true}>
          {input.field.label}
        </FieldLabel>
        {hasDescription ? (
          <FieldDescription id={fieldDescriptionId}>
            {renderIntegrationConnectionSetupStartFormFieldDescription(input.field)}
          </FieldDescription>
        ) : null}
      </FieldHeader>
      <FieldContent>
        {input.field.inputType === "radio" ? (
          <RadioGroup
            aria-describedby={hasDescription ? fieldDescriptionId : undefined}
            aria-label={input.field.label}
            onValueChange={(nextValue) => {
              input.onValueChange(input.field.name, nextValue);
            }}
            value={input.value}
          >
            {resolveSetupStartFormRadioOptions(input.field).map((option) => (
              <div className="flex items-start gap-3" key={option.value}>
                <RadioGroupItem id={`${inputId}-${option.value}`} value={option.value} />
                <label className="text-sm" htmlFor={`${inputId}-${option.value}`}>
                  {option.label}
                </label>
              </div>
            ))}
          </RadioGroup>
        ) : input.field.inputType === "textarea" ? (
          <Textarea
            aria-describedby={hasDescription ? fieldDescriptionId : undefined}
            autoComplete="off"
            id={inputId}
            onChange={(event) => input.onValueChange(input.field.name, event.target.value)}
            placeholder={input.field.placeholder}
            value={input.value}
          />
        ) : (
          <Input
            aria-describedby={hasDescription ? fieldDescriptionId : undefined}
            autoComplete="off"
            id={inputId}
            onChange={(event) => input.onValueChange(input.field.name, event.target.value)}
            placeholder={input.field.placeholder}
            type={input.field.inputType}
            value={input.value}
          />
        )}
      </FieldContent>
    </Field>
  );
}

function renderIntegrationConnectionSetupStartFormFieldDescription(
  field: IntegrationConnectionSetupStartFormFieldMetadata,
): React.ReactNode {
  const actions = field.actions ?? [];
  if (field.description === undefined) {
    return actions.map((action) => renderSetupStartFormFieldAction(action, "block"));
  }

  const descriptionNodes = renderDescriptionWithInlineActions(field.description, actions);
  const inlineActionLabels = new Set(
    actions
      .filter((action) => field.description?.includes(action.label) === true)
      .map((action) => action.label),
  );
  const remainingActionNodes = actions
    .filter((action) => !inlineActionLabels.has(action.label))
    .map((action) => renderSetupStartFormFieldAction(action, "block"));

  return (
    <>
      <span>{descriptionNodes}</span>
      {remainingActionNodes}
    </>
  );
}

function renderDescriptionWithInlineActions(
  description: string,
  actions: readonly IntegrationConnectionSetupStartFormFieldAction[],
): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let remainingDescription = description;

  for (const action of actions) {
    const actionIndex = remainingDescription.indexOf(action.label);
    if (actionIndex === -1) {
      continue;
    }

    const prefix = remainingDescription.slice(0, actionIndex);
    if (prefix.length > 0) {
      nodes.push(prefix);
    }
    nodes.push(renderSetupStartFormFieldAction(action));
    remainingDescription = remainingDescription.slice(actionIndex + action.label.length);
  }

  if (remainingDescription.length > 0) {
    nodes.push(remainingDescription);
  }

  return nodes;
}

function renderSetupStartFormFieldAction(
  action: IntegrationConnectionSetupStartFormFieldAction,
  className?: string,
): React.JSX.Element {
  return (
    <TextLink
      className={className}
      href={action.href}
      key={action.href}
      {...(action.opensInNewWindow === undefined
        ? {}
        : { opensInNewWindow: action.opensInNewWindow })}
    >
      {action.label}
    </TextLink>
  );
}

function resolveSetupStartFormRadioOptions(
  field: IntegrationFormConnectionMethodSetupStartForm["fields"][number],
): readonly { label: string; value: string }[] {
  if (field.inputType !== "radio") {
    throw new Error(`Setup start form field '${field.name}' is not a radio field.`);
  }

  if (field.options === undefined) {
    throw new Error(`Setup start form radio field '${field.name}' does not define options.`);
  }

  return field.options;
}
