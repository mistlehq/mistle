import {
  Button,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Input,
  InlineCode,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Notice,
  cn,
} from "@mistle/ui";
import { TrashIcon } from "@phosphor-icons/react";

import { FormPageFooter, FormPageSection, FormPageStack } from "../shared/form-page.js";
import { AgentInstructionsEditor } from "./agent-instructions-editor.js";
import { resolveWebhookAutomationFormState } from "./webhook-automation-form-state.js";
import {
  type WebhookAutomationFormOption,
  type WebhookAutomationFormValueKey,
  type WebhookAutomationFormValues,
} from "./webhook-automation-form-types.js";
import { DefaultWebhookAutomationMessageTemplate } from "./webhook-automation-input-template.js";
import { WebhookAutomationTitleEditor } from "./webhook-automation-title-editor.js";
import { type WebhookAutomationTriggerPickerDisabledState } from "./webhook-automation-trigger-picker-state.js";
import {
  WebhookAutomationTriggerPicker,
  WebhookAutomationTriggerPickerAddButton,
} from "./webhook-automation-trigger-picker.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationTriggerParameterValueMap,
} from "./webhook-automation-trigger-types.js";
export type {
  WebhookAutomationFormOption,
  WebhookAutomationFormValueKey,
  WebhookAutomationFormValues,
} from "./webhook-automation-form-types.js";
export type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";
export type { WebhookAutomationEventOptionAvailability } from "./webhook-automation-trigger-types.js";

type WebhookAutomationFormProps = {
  mode: "create" | "edit";
  values: WebhookAutomationFormValues;
  connectionOptions: readonly WebhookAutomationFormOption[];
  sandboxProfileOptions: readonly WebhookAutomationFormOption[];
  webhookEventOptions: readonly WebhookAutomationEventOption[];
  triggerPickerDisabledState: WebhookAutomationTriggerPickerDisabledState | null;
  fieldErrors: Partial<Record<WebhookAutomationFormValueKey, string>>;
  validationSummaryError: string | null;
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

function shouldRenderInlineFieldError(input: {
  key: WebhookAutomationFormValueKey;
  message: string | undefined;
}): boolean {
  if (input.message === undefined) {
    return false;
  }

  return input.key !== "name" && input.key !== "sandboxProfileId";
}

function FieldError(input: {
  message: string | undefined;
  className?: string;
}): React.JSX.Element | null {
  if (input.message === undefined) {
    return null;
  }

  return <p className={cn("text-destructive text-sm", input.className)}>{input.message}</p>;
}

function SelectField(input: {
  label: string;
  value: string;
  placeholder: string;
  options: readonly WebhookAutomationFormOption[];
  error: string | undefined;
  showInlineError?: boolean;
  orientation?: "vertical" | "horizontal";
  onValueChange: (value: string) => void;
}): React.JSX.Element {
  const selectedOption = input.options.find((option) => option.value === input.value);
  const isInvalid = input.error !== undefined;

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
          <SelectTrigger
            aria-invalid={isInvalid ? true : undefined}
            className={input.orientation === "horizontal" ? undefined : "w-full"}
          >
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
        <FieldError message={input.showInlineError === false ? undefined : input.error} />
      </FieldContent>
    </Field>
  );
}

export function WebhookAutomationForm(input: WebhookAutomationFormProps): React.JSX.Element {
  const inputTemplateLabelId = "automation-input-template-label";
  const instructionsLabelId = "automation-instructions-label";
  const submitLabel = input.mode === "create" ? "Create" : "Save";
  const formState = resolveWebhookAutomationFormState({
    webhookEventOptions: input.webhookEventOptions,
    selectedTriggerIds: input.values.triggerIds,
    conversationKeyTemplate: input.values.conversationKeyTemplate,
    triggerIdsError: input.fieldErrors.triggerIds,
  });

  return (
    <FormPageStack>
      {input.mode === "edit" ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <WebhookAutomationTitleEditor
              errorMessage={
                shouldRenderInlineFieldError({
                  key: "name",
                  message: input.fieldErrors.name,
                })
                  ? input.fieldErrors.name
                  : undefined
              }
              onCommit={(nextValue) => {
                input.onValueChange("name", nextValue);
              }}
              disabled={input.isDeleting || input.isSaving}
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
      ) : null}

      {input.formError === null ? null : (
        <Notice title="Automation could not be saved" variant="alert">
          {input.formError}
        </Notice>
      )}

      <FormPageSection>
        {input.mode === "edit" ? (
          <div className="border-b px-4 py-4">
            <div className="flex min-h-10 items-center justify-between gap-3">
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
          </div>
        ) : null}

        {input.mode === "create" ? (
          <div className="p-4">
            <Field orientation="horizontal">
              <FieldHeader>
                <FieldLabel htmlFor="automation-name">Automation name</FieldLabel>
              </FieldHeader>
              <FieldContent>
                <Input
                  aria-invalid={input.fieldErrors.name !== undefined ? true : undefined}
                  id="automation-name"
                  disabled={input.isDeleting || input.isSaving}
                  onChange={(event) => {
                    input.onValueChange("name", event.currentTarget.value);
                  }}
                  value={input.values.name}
                />
                <FieldError
                  message={
                    shouldRenderInlineFieldError({
                      key: "name",
                      message: input.fieldErrors.name,
                    })
                      ? input.fieldErrors.name
                      : undefined
                  }
                />
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
            showInlineError={false}
            value={input.values.sandboxProfileId}
          />
        </div>
      </FormPageSection>

      <FormPageSection
        header={
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Triggers</h2>
              {formState.triggerHeaderMessage === undefined ? null : (
                <p className="text-destructive text-sm">{formState.triggerHeaderMessage}</p>
              )}
            </div>
            <WebhookAutomationTriggerPickerAddButton
              error={input.fieldErrors.triggerIds}
              disabledState={input.triggerPickerDisabledState}
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
            disabledState={input.triggerPickerDisabledState}
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
            selectedConnectionId={formState.selectedConnectionId}
            selectedTriggerIds={input.values.triggerIds}
            showAddTriggerControl={false}
            triggerParameterValues={input.values.triggerParameterValues}
          />
        </div>

        {input.values.triggerIds.length === 0 ? null : (
          <div className="p-4">
            <Field orientation="horizontal">
              <FieldHeader>
                <FieldLabel>Group events by</FieldLabel>
              </FieldHeader>
              <FieldContent>
                <Select
                  disabled={formState.conversationKeySelectionState.options.length === 0}
                  onValueChange={(value) => {
                    if (value === null) {
                      return;
                    }

                    input.onValueChange("conversationKeyTemplate", value);
                  }}
                  value={formState.conversationKeySelectionState.selectedTemplate}
                >
                  <SelectTrigger
                    aria-invalid={
                      input.fieldErrors.conversationKeyTemplate !== undefined ? true : undefined
                    }
                    className="w-full"
                  >
                    <SelectValue placeholder="Select conversation grouping">
                      {formState.selectedConversationGroupingLabel}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {formState.conversationKeySelectionState.options.map((option) => (
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
              <div className="space-y-1">
                <FieldLabel id={instructionsLabelId}>Agent Instructions for Automation</FieldLabel>
                <FieldDescription>
                  Appended to the developer message when the automation is triggered.
                </FieldDescription>
              </div>
            </FieldHeader>
            <FieldContent>
              <AgentInstructionsEditor
                ariaLabelledBy={instructionsLabelId}
                disabled={input.isDeleting || input.isSaving}
                invalid={false}
                onChange={(nextValue) => {
                  input.onValueChange("instructions", nextValue);
                }}
                tokens={[]}
                value={input.values.instructions}
              />
            </FieldContent>
          </Field>
        </div>
      </FormPageSection>

      <FormPageSection>
        <div className="p-4">
          <Field>
            <FieldHeader>
              <div className="space-y-1">
                <FieldLabel id={inputTemplateLabelId}>Message Template</FieldLabel>
                {formState.hasSelectedTrigger ? (
                  <FieldDescription>
                    <span className="block">
                      Template for the message sent to the agent each time this automation is
                      triggered.
                    </span>
                    <span className="block">
                      Use <InlineCode variant="muted">{"{{ ... }}"}</InlineCode> to insert event
                      fields.
                    </span>
                  </FieldDescription>
                ) : (
                  <FieldDescription>
                    <span className="block">
                      Template for the message sent when this automation is triggered.
                    </span>
                    <span className="block">Select a trigger to insert event fields.</span>
                  </FieldDescription>
                )}
              </div>
            </FieldHeader>
            <FieldContent>
              <AgentInstructionsEditor
                ariaLabelledBy={inputTemplateLabelId}
                disabled={input.isDeleting || input.isSaving}
                invalid={input.fieldErrors.inputTemplate !== undefined}
                onChange={(nextValue) => {
                  input.onValueChange("inputTemplate", nextValue);
                }}
                placeholderText={DefaultWebhookAutomationMessageTemplate}
                tokens={formState.agentInstructionTokens}
                value={input.values.inputTemplate}
              />
              <FieldError
                message={
                  shouldRenderInlineFieldError({
                    key: "inputTemplate",
                    message: input.fieldErrors.inputTemplate,
                  })
                    ? input.fieldErrors.inputTemplate
                    : undefined
                }
                className="text-right text-xs"
              />
            </FieldContent>
          </Field>
        </div>
      </FormPageSection>

      <FormPageFooter>
        {input.validationSummaryError === null ? null : (
          <Notice appearance="subtle" variant="alert">
            {input.validationSummaryError}
          </Notice>
        )}
        <Button
          disabled={input.isDeleting || input.isSaving}
          onClick={input.onSubmit}
          type="button"
        >
          {input.isSaving ? "Saving..." : submitLabel}
        </Button>
      </FormPageFooter>
    </FormPageStack>
  );
}
