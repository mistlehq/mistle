import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@mistle/ui";
import { TrashIcon } from "@phosphor-icons/react";

import { FormPageFooter, FormPageHeader, FormPageSection } from "../shared/form-page.js";
import { resolveConversationKeyFieldOptions } from "./webhook-automation-conversation-key-field.js";
import { DefaultWebhookAutomationInputTemplate } from "./webhook-automation-input-template.js";
import { WebhookAutomationTitleEditor } from "./webhook-automation-title-editor.js";
import { WebhookAutomationTriggerPickerAddButton } from "./webhook-automation-trigger-picker.js";
import { WebhookAutomationTriggerPicker } from "./webhook-automation-trigger-picker.js";
import { resolveSelectedWebhookAutomationEventOptions } from "./webhook-automation-trigger-picker.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationTriggerParameterValueMap,
} from "./webhook-automation-trigger-types.js";
export type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";

export type WebhookAutomationFormOption = {
  value: string;
  label: string;
  description?: string;
};

export type WebhookAutomationFormValues = {
  name: string;
  sandboxProfileId: string;
  enabled: boolean;
  inputTemplate: string;
  conversationKeyTemplate: string;
  triggerIds: string[];
  triggerParameterValues: WebhookAutomationTriggerParameterValueMap;
};

export type WebhookAutomationFormValueKey = keyof WebhookAutomationFormValues;

type WebhookAutomationFormProps = {
  mode: "create" | "edit";
  values: WebhookAutomationFormValues;
  connectionOptions: readonly WebhookAutomationFormOption[];
  sandboxProfileOptions: readonly WebhookAutomationFormOption[];
  webhookEventOptions: readonly WebhookAutomationEventOption[];
  triggerPickerDisabledReason: string | null;
  fieldErrors: Partial<Record<WebhookAutomationFormValueKey, string>>;
  formError: string | null;
  isSaving: boolean;
  isDeleting: boolean;
  onValueChange: (
    key: WebhookAutomationFormValueKey,
    value: string | boolean | string[] | WebhookAutomationTriggerParameterValueMap,
  ) => void;
  onSubmit: () => void;
  onDelete: (() => void) | null;
};

function FieldError(input: { message: string | undefined }): React.JSX.Element | null {
  if (input.message === undefined) {
    return null;
  }

  return <p className="text-destructive text-sm">{input.message}</p>;
}

function SelectField(input: {
  label: string;
  value: string;
  placeholder: string;
  options: readonly WebhookAutomationFormOption[];
  error: string | undefined;
  orientation?: "vertical" | "horizontal";
  onValueChange: (value: string) => void;
}): React.JSX.Element {
  const selectedOption = input.options.find((option) => option.value === input.value);

  return (
    <Field orientation={input.orientation ?? "vertical"}>
      <FieldLabel>{input.label}</FieldLabel>
      <FieldContent>
        <Select
          onValueChange={(value) => {
            if (value === null) {
              return;
            }

            input.onValueChange(value);
          }}
          value={input.value}
        >
          <SelectTrigger className={input.orientation === "horizontal" ? undefined : "w-full"}>
            <SelectValue placeholder={input.placeholder}>{selectedOption?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {input.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <div className="flex flex-col gap-0.5">
                  <span>{option.label}</span>
                  {option.description === undefined ? null : (
                    <span className="text-muted-foreground text-xs">{option.description}</span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError message={input.error} />
      </FieldContent>
    </Field>
  );
}

export function WebhookAutomationForm(input: WebhookAutomationFormProps): React.JSX.Element {
  const submitLabel = input.mode === "create" ? "Create automation" : "Save changes";
  const selectedTriggerOptions = resolveSelectedWebhookAutomationEventOptions({
    eventOptions: input.webhookEventOptions,
    selectedTriggerIds: input.values.triggerIds,
  });
  const selectedConnectionIds = new Set(
    selectedTriggerOptions
      .map((option) => option.connectionId)
      .filter((connectionId) => connectionId.trim().length > 0),
  );
  const selectedConnectionId =
    selectedConnectionIds.size === 1 ? ([...selectedConnectionIds][0] ?? "") : "";
  const conversationKeySelectionState = resolveConversationKeyFieldOptions({
    selectedEventOptions: selectedTriggerOptions,
    currentTemplate: input.values.conversationKeyTemplate,
  });
  const selectedConversationGroupingOption = conversationKeySelectionState.options.find(
    (option) => option.template === conversationKeySelectionState.selectedTemplate,
  );
  const selectedConversationGroupingLabel =
    selectedConversationGroupingOption === undefined
      ? undefined
      : selectedConversationGroupingOption.label;
  const isInputTemplateDefault =
    input.values.inputTemplate === DefaultWebhookAutomationInputTemplate;

  return (
    <div className="flex flex-col gap-6">
      {input.mode === "create" ? (
        <FormPageHeader title="Create Automation" />
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <WebhookAutomationTitleEditor
              errorMessage={input.fieldErrors.name}
              onCommit={(nextValue) => {
                input.onValueChange("name", nextValue);
              }}
              saveDisabled={input.isDeleting || input.isSaving}
              title={input.values.name}
            />
          </div>

          {input.onDelete === null ? null : (
            <Button
              aria-label="Delete automation"
              disabled={input.isDeleting || input.isSaving}
              onClick={input.onDelete}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <TrashIcon aria-hidden className="size-4" />
            </Button>
          )}
        </div>
      )}

      {input.formError === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Could not save automation</AlertTitle>
          <AlertDescription>{input.formError}</AlertDescription>
        </Alert>
      )}

      {input.mode === "edit" ? (
        <FormPageSection>
          <div className="flex min-h-10 items-center justify-between gap-3 p-4">
            <div className="space-y-1">
              <FieldLabel htmlFor="automation-enabled">Automation enabled</FieldLabel>
            </div>
            <Switch
              aria-label="Automation enabled"
              checked={input.values.enabled}
              id="automation-enabled"
              onCheckedChange={(checked) => {
                input.onValueChange("enabled", checked);
              }}
            />
          </div>
        </FormPageSection>
      ) : null}

      <FormPageSection>
        {input.mode === "create" ? (
          <div className="p-4">
            <Field orientation="horizontal">
              <FieldHeader>
                <FieldLabel htmlFor="automation-name">Automation name</FieldLabel>
              </FieldHeader>
              <FieldContent>
                <Input
                  id="automation-name"
                  disabled={input.isDeleting || input.isSaving}
                  onChange={(event) => {
                    input.onValueChange("name", event.currentTarget.value);
                  }}
                  value={input.values.name}
                />
                <FieldError message={input.fieldErrors.name} />
              </FieldContent>
            </Field>
          </div>
        ) : null}
        <div className="p-4">
          <SelectField
            error={input.fieldErrors.sandboxProfileId}
            label="Sandbox profile"
            orientation="horizontal"
            onValueChange={(value) => {
              input.onValueChange("sandboxProfileId", value);
            }}
            options={input.sandboxProfileOptions}
            placeholder="Select profile"
            value={input.values.sandboxProfileId}
          />
        </div>
      </FormPageSection>

      <FormPageSection
        header={
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Triggers</h2>
            <WebhookAutomationTriggerPickerAddButton
              error={input.fieldErrors.triggerIds}
              disabledReason={input.triggerPickerDisabledReason}
              eventOptions={input.webhookEventOptions}
              hasConnectedIntegrations={input.connectionOptions.length > 0}
              onValueChange={(value) => {
                input.onValueChange("triggerIds", value);
              }}
              selectedTriggerIds={input.values.triggerIds}
              variant="header"
            />
          </div>
        }
      >
        <div className="p-4">
          <WebhookAutomationTriggerPicker
            error={input.fieldErrors.triggerIds}
            eventOptions={input.webhookEventOptions}
            hasConnectedIntegrations={input.connectionOptions.length > 0}
            disabledReason={input.triggerPickerDisabledReason}
            onTriggerParameterValueChange={({ triggerId, parameterId, value }) => {
              input.onValueChange("triggerParameterValues", {
                ...input.values.triggerParameterValues,
                [triggerId]: {
                  ...(input.values.triggerParameterValues[triggerId] ?? {}),
                  [parameterId]: value,
                },
              });
            }}
            onValueChange={(value) => {
              input.onValueChange("triggerIds", value);
            }}
            selectedConnectionId={selectedConnectionId}
            selectedTriggerIds={input.values.triggerIds}
            showAddTriggerControl={false}
            triggerParameterValues={input.values.triggerParameterValues}
          />
          <FieldError message={input.fieldErrors.triggerIds} />
        </div>

        {input.values.triggerIds.length === 0 ? null : (
          <div className="p-4">
            <Field orientation="horizontal">
              <FieldHeader>
                <FieldLabel>Group events by</FieldLabel>
              </FieldHeader>
              <FieldContent>
                <Select
                  disabled={conversationKeySelectionState.options.length === 0}
                  onValueChange={(value) => {
                    if (value === null) {
                      return;
                    }

                    input.onValueChange("conversationKeyTemplate", value);
                  }}
                  value={conversationKeySelectionState.selectedTemplate}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select conversation grouping">
                      {selectedConversationGroupingLabel}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {conversationKeySelectionState.options.map((option) => (
                      <SelectItem key={option.id} value={option.template}>
                        <div className="flex flex-col gap-0.5">
                          <span>{option.label}</span>
                          <span className="text-muted-foreground text-xs">
                            {option.description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={input.fieldErrors.conversationKeyTemplate} />
              </FieldContent>
            </Field>
          </div>
        )}
      </FormPageSection>

      <FormPageSection>
        <div className="p-4">
          <Field>
            <FieldHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <FieldLabel htmlFor="automation-input-template">Input Template</FieldLabel>
                  <FieldDescription>
                    Use Liquid templates. Available variables include{" "}
                    <code>{"{{webhookEvent.eventType}}"}</code> and <code>{"{{payload}}"}</code>.
                  </FieldDescription>
                </div>
                <Button
                  disabled={input.isDeleting || input.isSaving || isInputTemplateDefault}
                  onClick={() => {
                    input.onValueChange("inputTemplate", DefaultWebhookAutomationInputTemplate);
                  }}
                  type="button"
                  variant="outline"
                >
                  Reset to default
                </Button>
              </div>
            </FieldHeader>
            <FieldContent>
              <Textarea
                className="min-h-48 font-mono text-sm"
                id="automation-input-template"
                disabled={input.isDeleting || input.isSaving}
                onChange={(event) => {
                  input.onValueChange("inputTemplate", event.currentTarget.value);
                }}
                rows={8}
                value={input.values.inputTemplate}
              />
              <FieldError message={input.fieldErrors.inputTemplate} />
            </FieldContent>
          </Field>
        </div>
      </FormPageSection>

      <FormPageFooter>
        <Button
          disabled={input.isDeleting || input.isSaving}
          onClick={input.onSubmit}
          type="button"
        >
          {input.isSaving ? "Saving..." : submitLabel}
        </Button>
      </FormPageFooter>
    </div>
  );
}
