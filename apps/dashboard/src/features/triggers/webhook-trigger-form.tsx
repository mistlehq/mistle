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
  TriggerFormFieldError,
  TriggerFormShell,
  type TriggerFormShellStatusMessage,
} from "./trigger-form-shell.js";
import { type WebhookTriggerEventPickerDisabledState } from "./webhook-trigger-event-picker-state.js";
import {
  WebhookTriggerEventPicker,
  WebhookTriggerEventPickerAddButton,
} from "./webhook-trigger-event-picker.js";
import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterValueMap,
} from "./webhook-trigger-event-types.js";
import {
  resolveWebhookTriggerFormPresentation,
  resolveWebhookTriggerFormState,
} from "./webhook-trigger-form-state.js";
import {
  type WebhookTriggerFormOption,
  type WebhookTriggerFormValueKey,
  type WebhookTriggerFormValues,
} from "./webhook-trigger-form-types.js";
import { DefaultWebhookTriggerMessageTemplate } from "./webhook-trigger-input-template.js";
export type {
  WebhookTriggerFormOption,
  WebhookTriggerFormValueKey,
  WebhookTriggerFormValues,
} from "./webhook-trigger-form-types.js";
export type { WebhookTriggerEventOption } from "./webhook-trigger-event-types.js";
export type { WebhookTriggerEventOptionAvailability } from "./webhook-trigger-event-types.js";

type WebhookTriggerTypeSpecificSectionProps = {
  values: Pick<
    WebhookTriggerFormValues,
    "conversationKeyTemplate" | "eventIds" | "eventParameterValues"
  >;
  connectionOptions: readonly WebhookTriggerFormOption[];
  webhookEventOptions: readonly WebhookTriggerEventOption[];
  triggerPickerDisabledState: WebhookTriggerEventPickerDisabledState | null;
  fieldErrors: Pick<WebhookTriggerFormProps["fieldErrors"], "conversationKeyTemplate" | "eventIds">;
  formState: ReturnType<typeof resolveWebhookTriggerFormState>;
  onValueChange: (
    key: "conversationKeyTemplate" | "eventIds" | "eventParameterValues",
    value: string | string[] | WebhookTriggerEventParameterValueMap,
  ) => void;
};

type WebhookTriggerInstructionsSectionProps = {
  instructionsLabelId: string;
  value: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
};

type WebhookTriggerFormProps = {
  mode: "create" | "edit";
  values: WebhookTriggerFormValues;
  connectionOptions: readonly WebhookTriggerFormOption[];
  sandboxProfileOptions: readonly WebhookTriggerFormOption[];
  sandboxProfileStatusMessage?: TriggerFormShellStatusMessage | undefined;
  primaryRepositoryOptions?: readonly WebhookTriggerFormOption[];
  webhookEventOptions: readonly WebhookTriggerEventOption[];
  triggerPickerDisabledState: WebhookTriggerEventPickerDisabledState | null;
  fieldErrors: Partial<Record<WebhookTriggerFormValueKey, string>>;
  validationSummaryError: string | null;
  formError: string | null;
  isSaving: boolean;
  isDeleting: boolean;
  triggerTypeField?: ReactNode;
  onValueChange: (
    key: WebhookTriggerFormValueKey,
    value: string | boolean | string[] | WebhookTriggerEventParameterValueMap,
  ) => void;
  onSubmit: () => void;
  onDelete: (() => void) | null;
};

export function WebhookTriggerTypeSpecificSection(
  input: WebhookTriggerTypeSpecificSectionProps,
): React.JSX.Element {
  return (
    <FormPageSection
      header={
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">When this happens</h2>
            {input.formState.triggerHeaderMessage === undefined ? null : (
              <p className="text-destructive text-sm">{input.formState.triggerHeaderMessage}</p>
            )}
          </div>
          <WebhookTriggerEventPickerAddButton
            error={input.fieldErrors.eventIds}
            disabledState={input.triggerPickerDisabledState}
            eventOptions={input.webhookEventOptions}
            hasConnectedIntegrations={input.connectionOptions.length > 0}
            onValueChange={(value) => {
              input.onValueChange("eventIds", value);
            }}
            selectedEventIds={input.values.eventIds}
            variant="header"
          />
        </div>
      }
    >
      <div className="p-4">
        <WebhookTriggerEventPicker
          error={input.fieldErrors.eventIds}
          eventOptions={input.webhookEventOptions}
          hasConnectedIntegrations={input.connectionOptions.length > 0}
          disabledState={input.triggerPickerDisabledState}
          onEventParameterValueChange={({ triggerId, parameterId, value }) => {
            input.onValueChange("eventParameterValues", {
              ...input.values.eventParameterValues,
              [triggerId]: {
                ...(input.values.eventParameterValues[triggerId] ?? {}),
                [parameterId]: value,
              },
            });
          }}
          onValueChange={(value) => {
            input.onValueChange("eventIds", value);
          }}
          selectedConnectionId={input.formState.selectedConnectionId}
          selectedEventIds={input.values.eventIds}
          showAddTriggerControl={false}
          eventParameterValues={input.values.eventParameterValues}
        />
      </div>

      {input.values.eventIds.length === 0 ? null : (
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
              <TriggerFormFieldError message={input.fieldErrors.conversationKeyTemplate} />
            </FieldContent>
          </Field>
        </div>
      )}
    </FormPageSection>
  );
}

export function WebhookTriggerInstructionsSection(
  input: WebhookTriggerInstructionsSectionProps,
): React.JSX.Element {
  return (
    <FormPageSection>
      <div className="p-4">
        <Field>
          <FieldHeader>
            <div className="space-y-1">
              <FieldLabel id={input.instructionsLabelId}>Agent Instructions for Trigger</FieldLabel>
              <FieldDescription>
                Appended to the developer message when this trigger runs.
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

export function WebhookTriggerForm(input: WebhookTriggerFormProps): React.JSX.Element {
  const inputTemplateLabelId = "trigger-input-template-label";
  const instructionsLabelId = "trigger-instructions-label";
  const presentation = resolveWebhookTriggerFormPresentation({
    mode: input.mode,
    values: input.values,
    primaryRepositoryOptions: input.primaryRepositoryOptions,
  });
  const formState = resolveWebhookTriggerFormState({
    webhookEventOptions: input.webhookEventOptions,
    selectedEventIds: input.values.eventIds,
    conversationKeyTemplate: input.values.conversationKeyTemplate,
    eventParameterValues: input.values.eventParameterValues,
    eventIdsError: input.fieldErrors.eventIds,
  });

  return (
    <TriggerFormShell
      enabled={input.values.enabled}
      {...(input.triggerTypeField === undefined
        ? {}
        : { triggerTypeField: input.triggerTypeField })}
      fieldErrors={input.fieldErrors}
      formError={input.formError}
      inputIdPrefix="trigger"
      inputTemplate={input.values.inputTemplate}
      inputTemplateDescription={
        formState.hasSelectedTrigger ? (
          <>
            <span className="block">Sent to the agent each time this trigger runs.</span>
            <span className="block">
              Use <InlineCode variant="muted">{"{{ ... }}"}</InlineCode> to insert event fields.
            </span>
          </>
        ) : (
          <>
            <span className="block">Sent to the agent each time this trigger runs.</span>
            <span className="block">Select an event to insert event fields.</span>
          </>
        )
      }
      inputTemplateLabelId={inputTemplateLabelId}
      inputTemplatePlaceholderText={DefaultWebhookTriggerMessageTemplate}
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
      shouldShowTriggerEnabledField={presentation.shouldShowTriggerEnabledField}
      shouldShowCreateNameField={presentation.shouldShowCreateNameField}
      shouldShowPrimaryRepositoryField={presentation.shouldShowPrimaryRepositoryField}
      submitLabel={presentation.submitLabel}
      validationSummaryError={input.validationSummaryError}
      typeSpecificSection={
        <WebhookTriggerTypeSpecificSection
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
        <WebhookTriggerInstructionsSection
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
