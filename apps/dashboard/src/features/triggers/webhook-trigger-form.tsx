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
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";

import {
  listIntegrationConnectionResources,
  type IntegrationConnection,
  type IntegrationConnectionResource,
  type IntegrationConnectionResources,
} from "../integrations/integrations-service.js";
import { FormPageSection } from "../shared/form-page.js";
import {
  AgentInstructionsEditor,
  type AgentInstructionsResourceReferenceLoader,
} from "./agent-instructions-editor.js";
import { buildAgentInstructionsResourceReferences } from "./agent-instructions-token-catalog.js";
import {
  TriggerFormFieldError,
  TriggerFormShell,
  type TriggerFormShellStatusMessage,
} from "./trigger-form-shell.js";
import { WebhookTriggerActorPolicyFields } from "./webhook-trigger-actor-policy-fields.js";
import { type WebhookTriggerEventPickerDisabledState } from "./webhook-trigger-event-picker-state.js";
import {
  WebhookTriggerEventPicker,
  WebhookTriggerEventPickerAddButton,
} from "./webhook-trigger-event-picker.js";
import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterRuleMap,
} from "./webhook-trigger-event-types.js";
import {
  resolveWebhookTriggerFormPresentation,
  resolveWebhookTriggerFormState,
} from "./webhook-trigger-form-state.js";
import {
  type WebhookTriggerFormOption,
  type WebhookTriggerFormFieldErrors,
  type WebhookTriggerFormValueKey,
  type WebhookTriggerFormValues,
} from "./webhook-trigger-form-types.js";
import { DefaultWebhookTriggerMessageTemplate } from "./webhook-trigger-input-template.js";
import { createTriggerParameterResourceQueryKey } from "./webhook-trigger-resource-query-keys.js";
export type {
  WebhookTriggerFormFieldErrors,
  WebhookTriggerFormOption,
  WebhookTriggerFormValueKey,
  WebhookTriggerFormValues,
} from "./webhook-trigger-form-types.js";
export type { WebhookTriggerEventOption } from "./webhook-trigger-event-types.js";
export type { WebhookTriggerEventOptionAvailability } from "./webhook-trigger-event-types.js";

type WebhookTriggerTypeSpecificSectionProps = {
  values: Pick<
    WebhookTriggerFormValues,
    "conversationKeyTemplate" | "eventIds" | "eventParameterRules"
  >;
  connectionOptions: readonly WebhookTriggerFormOption[];
  webhookEventOptions: readonly WebhookTriggerEventOption[];
  triggerPickerDisabledState: WebhookTriggerEventPickerDisabledState | null;
  disabled: boolean;
  fieldErrors: Pick<
    WebhookTriggerFormFieldErrors,
    "conversationKeyTemplate" | "eventIds" | "eventParameterRules"
  >;
  formState: ReturnType<typeof resolveWebhookTriggerFormState>;
  onValueChange: WebhookTriggerTypeSpecificValueChangeHandler;
};

type WebhookTriggerTypeSpecificValueChangeHandler = (
  ...args:
    | ["conversationKeyTemplate", string]
    | ["eventActorPolicies", WebhookTriggerFormValues["eventActorPolicies"]]
    | ["eventIds", string[]]
    | ["eventParameterRules", WebhookTriggerEventParameterRuleMap]
) => void;

type WebhookTriggerInstructionsSectionProps = {
  instructionsLabelId: string;
  value: string;
  disabled: boolean;
  loadResourceReferences?: AgentInstructionsResourceReferenceLoader;
  onValueChange: (value: string) => void;
};

type WebhookTriggerFormProps = {
  mode: "create" | "edit";
  values: WebhookTriggerFormValues;
  connectionOptions: readonly WebhookTriggerFormOption[];
  connections: readonly IntegrationConnection[];
  sandboxProfileOptions: readonly WebhookTriggerFormOption[];
  sandboxProfileStatusMessage?: TriggerFormShellStatusMessage | undefined;
  primaryRepositoryOptions?: readonly WebhookTriggerFormOption[];
  webhookEventOptions: readonly WebhookTriggerEventOption[];
  triggerPickerDisabledState: WebhookTriggerEventPickerDisabledState | null;
  fieldErrors: WebhookTriggerFormFieldErrors;
  validationSummaryError: string | null;
  formError: string | null;
  formErrorTitle?: string;
  isSaving: boolean;
  isDeleting: boolean;
  isDuplicating: boolean;
  triggerTypeField?: ReactNode;
  onValueChange: (
    key: WebhookTriggerFormValueKey,
    value:
      | string
      | boolean
      | string[]
      | WebhookTriggerFormValues["eventActorPolicies"]
      | WebhookTriggerEventParameterRuleMap,
  ) => void;
  onSubmit: () => void;
  onDuplicate: (() => void) | null;
  onDelete: (() => void) | null;
  onViewActivity?: (() => void) | null;
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
            disabled={input.disabled}
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
          disabled={input.disabled}
          eventOptions={input.webhookEventOptions}
          {...(input.fieldErrors.eventParameterRules === undefined
            ? {}
            : { eventParameterError: input.fieldErrors.eventParameterRules })}
          hasConnectedIntegrations={input.connectionOptions.length > 0}
          disabledState={input.triggerPickerDisabledState}
          onEventParameterRuleChange={({ triggerId, parameterId, rule }) => {
            input.onValueChange("eventParameterRules", {
              ...input.values.eventParameterRules,
              [triggerId]: {
                ...(input.values.eventParameterRules[triggerId] ?? {}),
                [parameterId]: rule,
              },
            });
          }}
          onEventParameterRulesChange={({ triggerId, rules }) => {
            input.onValueChange("eventParameterRules", {
              ...input.values.eventParameterRules,
              [triggerId]: rules,
            });
          }}
          onValueChange={(value) => {
            input.onValueChange("eventIds", value);
          }}
          selectedConnectionId={input.formState.selectedConnectionId}
          selectedEventIds={input.values.eventIds}
          showAddTriggerControl={false}
          eventParameterRules={input.values.eventParameterRules}
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
                disabled={
                  input.disabled ||
                  input.formState.conversationKeySelectionState.options.length === 0
                }
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
              {...(input.loadResourceReferences === undefined
                ? {}
                : { loadResourceReferences: input.loadResourceReferences })}
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

export function useWebhookTriggerResourceReferenceLoader(input: {
  selectedConnectionId: string;
  selectedConnectionLabel: string;
  resourceKinds: readonly string[];
}): AgentInstructionsResourceReferenceLoader {
  const queryClient = useQueryClient();

  return useMemo(
    () => async (loaderInput) => {
      if (input.selectedConnectionId.trim().length === 0 || input.resourceKinds.length === 0) {
        return [];
      }

      const resources = await Promise.all(
        input.resourceKinds.map((resourceKind) =>
          loadTriggerInstructionResourceReferenceResources({
            connectionId: input.selectedConnectionId,
            query: loaderInput.query,
            queryClient,
            resourceKind,
            signal: loaderInput.signal,
          }),
        ),
      );

      return buildAgentInstructionsResourceReferences({
        providerLabel: input.selectedConnectionLabel,
        resources: resources.flat(),
      });
    },
    [input.resourceKinds, input.selectedConnectionId, input.selectedConnectionLabel, queryClient],
  );
}

async function loadTriggerInstructionResourceReferenceResources(input: {
  connectionId: string;
  query: string;
  queryClient: QueryClient;
  resourceKind: string;
  signal: AbortSignal;
}): Promise<readonly IntegrationConnectionResource[]> {
  const cachedResources = input.queryClient.getQueryData<IntegrationConnectionResources>(
    createTriggerParameterResourceQueryKey({
      connectionId: input.connectionId,
      resourceKind: input.resourceKind,
    }),
  );
  if (cachedResources !== undefined) {
    return filterTriggerInstructionResourceReferenceResources({
      query: input.query,
      resources: cachedResources.items,
    });
  }

  if (input.query.length === 0) {
    return [];
  }

  const loadedResources = await listIntegrationConnectionResources({
    connectionId: input.connectionId,
    kind: input.resourceKind,
    search: input.query,
    signal: input.signal,
  });

  return loadedResources.items;
}

function filterTriggerInstructionResourceReferenceResources(input: {
  query: string;
  resources: readonly IntegrationConnectionResource[];
}): readonly IntegrationConnectionResource[] {
  const normalizedQuery = input.query.toLowerCase();

  return input.resources.filter((resource) =>
    [resource.displayName, resource.handle, resource.externalId].some((searchValue) =>
      (searchValue ?? "").toLowerCase().includes(normalizedQuery),
    ),
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
    eventParameterRules: input.values.eventParameterRules,
    eventIdsError: input.fieldErrors.eventIds,
  });
  const disabled = input.isDeleting || input.isSaving || input.isDuplicating;
  const resourceReferenceLoader = useWebhookTriggerResourceReferenceLoader({
    selectedConnectionId: formState.selectedConnectionId,
    selectedConnectionLabel: formState.selectedTriggerConnectionLabel,
    resourceKinds: formState.triggerInstructionResourceKinds,
  });

  return (
    <TriggerFormShell
      enabled={input.values.enabled}
      {...(input.triggerTypeField === undefined
        ? {}
        : { triggerTypeField: input.triggerTypeField })}
      fieldErrors={input.fieldErrors}
      formError={input.formError}
      formErrorTitle={input.formErrorTitle ?? "Trigger could not be saved"}
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
      inputTemplateResourceReferenceLoader={resourceReferenceLoader}
      inputTemplateTokens={formState.agentInstructionTokens}
      isDeleting={input.isDeleting}
      isDuplicating={input.isDuplicating}
      isSaving={input.isSaving}
      mode={input.mode}
      name={input.values.name}
      onDelete={input.onDelete}
      onDuplicate={input.onDuplicate}
      onSubmit={input.onSubmit}
      onViewActivity={input.onViewActivity ?? null}
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
          disabled={disabled}
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
        <>
          <WebhookTriggerActorPolicyFields
            connections={input.connections}
            disabled={disabled}
            eventActorPolicies={input.values.eventActorPolicies}
            onActorPoliciesChange={(policies) => {
              input.onValueChange("eventActorPolicies", policies);
            }}
            selectedEventIds={input.values.eventIds}
            webhookEventOptions={input.webhookEventOptions}
          />
          <WebhookTriggerInstructionsSection
            disabled={disabled}
            instructionsLabelId={instructionsLabelId}
            onValueChange={(value) => {
              input.onValueChange("instructions", value);
            }}
            loadResourceReferences={resourceReferenceLoader}
            value={input.values.instructions}
          />
        </>
      }
    />
  );
}
