import {
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  InlineCode,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";
import type { ReactNode } from "react";

import { FormPageSection } from "../shared/form-page.js";
import { AgentInstructionsEditor } from "./agent-instructions-editor.js";
import {
  AutomationFormFieldError,
  AutomationFormShell,
  type AutomationFormShellStatusMessage,
} from "./automation-form-shell.js";
import {
  resolveWebhookAutomationFormPresentation,
  resolveWebhookAutomationFormState,
} from "./webhook-automation-form-state.js";
import {
  type WebhookAutomationFormOption,
  type WebhookAutomationFormValueKey,
  type WebhookAutomationFormValues,
} from "./webhook-automation-form-types.js";
import { DefaultWebhookAutomationMessageTemplate } from "./webhook-automation-input-template.js";
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

type WebhookAutomationTypeSpecificSectionProps = {
  values: Pick<
    WebhookAutomationFormValues,
    "conversationKeyTemplate" | "triggerIds" | "triggerParameterValues"
  >;
  connectionOptions: readonly WebhookAutomationFormOption[];
  webhookEventOptions: readonly WebhookAutomationEventOption[];
  triggerPickerDisabledState: WebhookAutomationTriggerPickerDisabledState | null;
  fieldErrors: Pick<
    WebhookAutomationFormProps["fieldErrors"],
    "conversationKeyTemplate" | "triggerIds"
  >;
  formState: ReturnType<typeof resolveWebhookAutomationFormState>;
  onValueChange: (
    key: "conversationKeyTemplate" | "triggerIds" | "triggerParameterValues",
    value: string | string[] | WebhookAutomationTriggerParameterValueMap,
  ) => void;
};

type WebhookAutomationInstructionsSectionProps = {
  instructionsLabelId: string;
  value: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
};

type WebhookAutomationFormProps = {
  mode: "create" | "edit";
  values: WebhookAutomationFormValues;
  connectionOptions: readonly WebhookAutomationFormOption[];
  sandboxProfileOptions: readonly WebhookAutomationFormOption[];
  sandboxProfileStatusMessage?: AutomationFormShellStatusMessage | undefined;
  primaryRepositoryOptions?: readonly WebhookAutomationFormOption[];
  webhookEventOptions: readonly WebhookAutomationEventOption[];
  triggerPickerDisabledState: WebhookAutomationTriggerPickerDisabledState | null;
  fieldErrors: Partial<Record<WebhookAutomationFormValueKey, string>>;
  validationSummaryError: string | null;
  formError: string | null;
  isSaving: boolean;
  isDeleting: boolean;
  automationTypeField?: ReactNode;
  onValueChange: (
    key: WebhookAutomationFormValueKey,
    value: string | boolean | string[] | WebhookAutomationTriggerParameterValueMap,
  ) => void;
  onSubmit: () => void;
  onDelete: (() => void) | null;
};

export function WebhookAutomationTypeSpecificSection(
  input: WebhookAutomationTypeSpecificSectionProps,
): React.JSX.Element {
  return (
    <FormPageSection
      header={
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Events</h2>
            {input.formState.triggerHeaderMessage === undefined ? null : (
              <p className="text-destructive text-sm">{input.formState.triggerHeaderMessage}</p>
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
          selectedConnectionId={input.formState.selectedConnectionId}
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
                disabled={input.formState.conversationKeySelectionState.options.length === 0}
                onValueChange={(value) => {
                  if (value === null) {
                    return;
                  }

                  input.onValueChange("conversationKeyTemplate", value);
                }}
                value={input.formState.conversationKeySelectionState.selectedTemplate}
              >
                <SelectTrigger
                  aria-invalid={
                    input.fieldErrors.conversationKeyTemplate !== undefined ? true : undefined
                  }
                  className="w-full"
                >
                  <SelectValue placeholder="Select conversation grouping">
                    {input.formState.selectedConversationGroupingLabel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {input.formState.conversationKeySelectionState.options.map((option) => (
                    <SelectItem key={option.id} value={option.template}>
                      <div className="flex flex-col gap-0.5">
                        <span>{option.label}</span>
                        <span className="text-muted-foreground text-xs">{option.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <AutomationFormFieldError message={input.fieldErrors.conversationKeyTemplate} />
            </FieldContent>
          </Field>
        </div>
      )}
    </FormPageSection>
  );
}

export function WebhookAutomationInstructionsSection(
  input: WebhookAutomationInstructionsSectionProps,
): React.JSX.Element {
  return (
    <FormPageSection>
      <div className="p-4">
        <Field>
          <FieldHeader>
            <div className="space-y-1">
              <FieldLabel id={input.instructionsLabelId}>
                Agent Instructions for Automation
              </FieldLabel>
              <FieldDescription>
                Appended to the developer message when the automation is triggered.
              </FieldDescription>
            </div>
          </FieldHeader>
          <FieldContent>
            <AgentInstructionsEditor
              ariaLabelledBy={input.instructionsLabelId}
              disabled={input.disabled}
              invalid={false}
              onChange={input.onValueChange}
              tokens={[]}
              value={input.value}
            />
          </FieldContent>
        </Field>
      </div>
    </FormPageSection>
  );
}

export function WebhookAutomationForm(input: WebhookAutomationFormProps): React.JSX.Element {
  const inputTemplateLabelId = "automation-input-template-label";
  const instructionsLabelId = "automation-instructions-label";
  const presentation = resolveWebhookAutomationFormPresentation({
    mode: input.mode,
    values: input.values,
    primaryRepositoryOptions: input.primaryRepositoryOptions,
  });
  const formState = resolveWebhookAutomationFormState({
    webhookEventOptions: input.webhookEventOptions,
    selectedTriggerIds: input.values.triggerIds,
    conversationKeyTemplate: input.values.conversationKeyTemplate,
    triggerIdsError: input.fieldErrors.triggerIds,
  });

  return (
    <AutomationFormShell
      enabled={input.values.enabled}
      {...(input.automationTypeField === undefined
        ? {}
        : { automationTypeField: input.automationTypeField })}
      fieldErrors={input.fieldErrors}
      formError={input.formError}
      inputIdPrefix="automation"
      inputTemplate={input.values.inputTemplate}
      inputTemplateDescription={
        formState.hasSelectedTrigger ? (
          <>
            <span className="block">Sent to the agent each time the automation runs.</span>
            <span className="block">
              Use <InlineCode variant="muted">{"{{ ... }}"}</InlineCode> to insert event fields.
            </span>
          </>
        ) : (
          <>
            <span className="block">Sent to the agent each time the automation runs.</span>
            <span className="block">Select a trigger to insert event fields.</span>
          </>
        )
      }
      inputTemplateLabelId={inputTemplateLabelId}
      inputTemplatePlaceholderText={DefaultWebhookAutomationMessageTemplate}
      inputTemplateTokens={formState.agentInstructionTokens}
      isDeleting={input.isDeleting}
      isSaving={input.isSaving}
      mode={input.mode}
      name={input.values.name}
      onDelete={input.onDelete}
      onSubmit={input.onSubmit}
      onValueChange={(key, value) => {
        input.onValueChange(key, value);
      }}
      primaryRepositoryId={input.values.primaryRepositoryId}
      {...(input.primaryRepositoryOptions === undefined
        ? {}
        : { primaryRepositoryOptions: input.primaryRepositoryOptions })}
      sandboxProfileId={input.values.sandboxProfileId}
      sandboxProfileOptions={input.sandboxProfileOptions}
      {...(input.sandboxProfileStatusMessage === undefined
        ? {}
        : { sandboxProfileStatusMessage: input.sandboxProfileStatusMessage })}
      selectedPrimaryRepositoryPath={presentation.selectedPrimaryRepositoryPath}
      selectedWorkspaceRoot={presentation.selectedWorkspaceRoot}
      shouldShowAutomationEnabledField={presentation.shouldShowAutomationEnabledField}
      shouldShowCreateNameField={presentation.shouldShowCreateNameField}
      shouldShowPrimaryRepositoryField={presentation.shouldShowPrimaryRepositoryField}
      submitLabel={presentation.submitLabel}
      validationSummaryError={input.validationSummaryError}
      typeSpecificSection={
        <WebhookAutomationTypeSpecificSection
          connectionOptions={input.connectionOptions}
          fieldErrors={input.fieldErrors}
          formState={formState}
          onValueChange={(key, value) => {
            input.onValueChange(key, value);
          }}
          triggerPickerDisabledState={input.triggerPickerDisabledState}
          values={input.values}
          webhookEventOptions={input.webhookEventOptions}
        />
      }
      extraSectionsBeforeMessage={
        <WebhookAutomationInstructionsSection
          disabled={input.isDeleting || input.isSaving}
          instructionsLabelId={instructionsLabelId}
          onValueChange={(value) => {
            input.onValueChange("instructions", value);
          }}
          value={input.values.instructions}
        />
      }
    />
  );
}
