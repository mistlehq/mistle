import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
  type AssociatedResourceEventType,
} from "@mistle/integrations-core";
import {
  Button,
  Checkbox,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabelWithTooltip,
  Notice,
} from "@mistle/ui";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useCallback, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type { IntegrationTarget } from "../integrations/integrations-service.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  extractWebhookTriggerEventParameterRules,
  mergeWebhookTriggerPayloadFilter,
} from "../triggers/webhook-trigger-event-parameters.js";
import { WebhookTriggerEventPicker } from "../triggers/webhook-trigger-event-picker.js";
import {
  type WebhookTriggerEventOption,
  type WebhookTriggerEventParameterGroup,
  type WebhookTriggerEventParameterOption,
  type WebhookTriggerEventParameterRule,
  type WebhookTriggerEventParameterRuleMap,
} from "../triggers/webhook-trigger-event-types.js";

const GitHubPullRequestEventOptions: ReadonlyArray<{
  eventType: AssociatedResourceEventType;
  label: string;
}> = [
  {
    eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED,
    label: "PR comments",
  },
  {
    eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED,
    label: "PR reviews",
  },
  {
    eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_COMMENT_CREATED,
    label: "Review comments",
  },
];

const AllGitHubPullRequestEventTypes = GitHubPullRequestEventOptions.map(
  (option) => option.eventType,
);

type AssociatedResourceRoutingConfig =
  SandboxProfileVersion["associatedResourceEventRoutingConfig"];
type AssociatedResourceEventDefinition = NonNullable<
  IntegrationTarget["supportedAssociatedResourceEvents"]
>[number];
type AssociatedResourceEventParameterDefinition = NonNullable<
  AssociatedResourceEventDefinition["parameters"]
>[number];
type AssociatedResourceEventParameterGroupDefinition = NonNullable<
  AssociatedResourceEventDefinition["parameterGroups"]
>[number];

type AssociatedResourceRoutingDraft = {
  enabled: boolean;
  eventTypes: AssociatedResourceEventType[];
  advancedPayloadFilter: Record<string, unknown> | null;
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
};

export type SandboxProfileAssociatedResourceRoutingDraftState = {
  hasUnpersistedChanges: boolean;
  applyDraftSaveError?: (error: unknown) => void;
  applySavedAssociatedResourceEventRoutingConfig?: (
    config: AssociatedResourceRoutingConfig,
  ) => void;
  buildDraftChanges?: () => AssociatedResourceRoutingConfig;
};

export function SandboxProfileAssociatedResourceRoutingFieldGroup(input: {
  disabled: boolean;
  hasGitHubBinding: boolean;
  isDraft: boolean;
  onDraftStateChange?: (state: SandboxProfileAssociatedResourceRoutingDraftState) => void;
  selectedConnectionId?: string | undefined;
  supportedAssociatedResourceEvents?: readonly AssociatedResourceEventDefinition[] | undefined;
  version: SandboxProfileVersion;
}): React.JSX.Element {
  const remountKey = createAssociatedResourceRoutingFieldGroupStateKey({
    config: input.version.associatedResourceEventRoutingConfig,
    supportedAssociatedResourceEvents: input.supportedAssociatedResourceEvents ?? [],
  });

  return (
    <SandboxProfileAssociatedResourceRoutingStatefulSection
      disabled={input.disabled}
      hasGitHubBinding={input.hasGitHubBinding}
      isDraft={input.isDraft}
      key={remountKey}
      {...(input.onDraftStateChange === undefined
        ? {}
        : { onDraftStateChange: input.onDraftStateChange })}
      selectedConnectionId={input.selectedConnectionId}
      supportedAssociatedResourceEvents={input.supportedAssociatedResourceEvents}
      version={input.version}
    />
  );
}

function SandboxProfileAssociatedResourceRoutingStatefulSection(input: {
  disabled: boolean;
  hasGitHubBinding: boolean;
  isDraft: boolean;
  onDraftStateChange?: (state: SandboxProfileAssociatedResourceRoutingDraftState) => void;
  selectedConnectionId?: string | undefined;
  supportedAssociatedResourceEvents?: readonly AssociatedResourceEventDefinition[] | undefined;
  version: SandboxProfileVersion;
}): React.JSX.Element {
  const eventOptions = createAssociatedResourceEventOptions({
    supportedAssociatedResourceEvents: input.supportedAssociatedResourceEvents ?? [],
  });
  const initialDraft = createAssociatedResourceRoutingDraft({
    config: input.version.associatedResourceEventRoutingConfig,
    eventOptions,
    hasGitHubBinding: input.hasGitHubBinding,
  });
  const [draft, setDraft] = useState<AssociatedResourceRoutingDraft>(initialDraft);
  const [persistedDraft, setPersistedDraft] =
    useState<AssociatedResourceRoutingDraft>(initialDraft);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const fieldIsReadOnly = input.disabled || !input.isDraft;
  const selectedEventTypes = draft.eventTypes;

  const applyDraftSaveError = useCallback((error: unknown): void => {
    setSaveErrorMessage(
      resolveApiErrorMessage({
        error,
        fallbackMessage: "Could not save associated resource routing.",
      }),
    );
  }, []);

  const applySavedAssociatedResourceEventRoutingConfig = useCallback(
    (config: AssociatedResourceRoutingConfig): void => {
      const nextDraft = createAssociatedResourceRoutingDraft({
        config,
        eventOptions,
        hasGitHubBinding: input.hasGitHubBinding,
      });
      setDraft(nextDraft);
      setPersistedDraft(nextDraft);
      setSaveErrorMessage(null);
      input.onDraftStateChange?.({
        hasUnpersistedChanges: false,
      });
    },
    [eventOptions, input.hasGitHubBinding, input.onDraftStateChange],
  );

  function publishDraftState(nextDraft: AssociatedResourceRoutingDraft): void {
    input.onDraftStateChange?.({
      applyDraftSaveError,
      applySavedAssociatedResourceEventRoutingConfig,
      buildDraftChanges: () => createAssociatedResourceRoutingConfig(nextDraft, eventOptions),
      hasUnpersistedChanges: !associatedResourceRoutingDraftsAreEqual(nextDraft, persistedDraft),
    });
  }

  function updateDraft(nextDraft: AssociatedResourceRoutingDraft): void {
    setDraft(nextDraft);
    setSaveErrorMessage(null);
    publishDraftState(nextDraft);
  }

  function updateEventType(eventType: AssociatedResourceEventType, checked: boolean): void {
    if (fieldIsReadOnly) {
      return;
    }

    const nextEventTypes = checked
      ? [...new Set([...selectedEventTypes, eventType])]
      : selectedEventTypes.filter((selectedEventType) => selectedEventType !== eventType);
    const sortedEventTypes = sortAssociatedResourceEventTypes(nextEventTypes);

    updateDraft({
      advancedPayloadFilter: draft.advancedPayloadFilter,
      enabled: sortedEventTypes.length > 0,
      eventTypes: sortedEventTypes,
      eventParameterRules: draft.eventParameterRules,
    });
  }

  function updateEventParameterRule(input: {
    triggerId: string;
    parameterId: string;
    rule: WebhookTriggerEventParameterRule;
  }): void {
    if (fieldIsReadOnly) {
      return;
    }

    updateDraft({
      advancedPayloadFilter: draft.advancedPayloadFilter,
      enabled: draft.eventTypes.length > 0,
      eventTypes: draft.eventTypes,
      eventParameterRules: {
        ...draft.eventParameterRules,
        [input.triggerId]: {
          ...(draft.eventParameterRules[input.triggerId] ?? {}),
          [input.parameterId]: input.rule,
        },
      },
    });
  }

  function updateEventParameterRules(input: {
    triggerId: string;
    rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
  }): void {
    if (fieldIsReadOnly) {
      return;
    }

    updateDraft({
      advancedPayloadFilter: draft.advancedPayloadFilter,
      enabled: draft.eventTypes.length > 0,
      eventTypes: draft.eventTypes,
      eventParameterRules: {
        ...draft.eventParameterRules,
        [input.triggerId]: input.rules,
      },
    });
  }

  return (
    <SandboxProfileAssociatedResourceRoutingFields
      draftEnabled={draft.enabled}
      fieldIsReadOnly={fieldIsReadOnly}
      onEventTypeChange={updateEventType}
      onEventParameterRuleChange={updateEventParameterRule}
      onEventParameterRulesChange={updateEventParameterRules}
      onSettingsExpandedChange={setSettingsExpanded}
      saveErrorMessage={saveErrorMessage}
      selectedConnectionId={input.selectedConnectionId}
      selectedEventTypes={selectedEventTypes}
      settingsExpanded={settingsExpanded}
      eventOptions={eventOptions}
      eventParameterRules={draft.eventParameterRules}
    />
  );
}

function SandboxProfileAssociatedResourceRoutingFields(input: {
  draftEnabled: boolean;
  fieldIsReadOnly: boolean;
  eventOptions: readonly WebhookTriggerEventOption[];
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
  onEventParameterRuleChange: (input: {
    triggerId: string;
    parameterId: string;
    rule: WebhookTriggerEventParameterRule;
  }) => void;
  onEventParameterRulesChange: (input: {
    triggerId: string;
    rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
  }) => void;
  onEventTypeChange: (eventType: AssociatedResourceEventType, checked: boolean) => void;
  onSettingsExpandedChange: (expanded: boolean) => void;
  saveErrorMessage: string | null;
  selectedConnectionId?: string | undefined;
  selectedEventTypes: readonly AssociatedResourceEventType[];
  settingsExpanded: boolean;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {input.saveErrorMessage === null ? null : (
        <Notice title={input.saveErrorMessage} variant="alert" />
      )}
      <Field contentWidth="fill" orientation="horizontal">
        <FieldHeader>
          <FieldLabelWithTooltip
            htmlFor="sandbox-profile-associated-resources-github-pr-settings"
            tooltip="Send selected GitHub activity back to the agent that opened the PR."
            tooltipLabel="Explain agent PR activity"
          >
            Agent PR activity
          </FieldLabelWithTooltip>
        </FieldHeader>
        <FieldContent>
          <Button
            aria-controls="sandbox-profile-associated-resources-github-pr-settings-panel"
            aria-expanded={input.settingsExpanded}
            aria-label="Configure Agent PR activity"
            className="text-foreground hover:text-primary focus-visible:text-primary flex min-h-10 w-fit min-w-0 justify-start gap-2 px-0 text-sm font-medium hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-foreground"
            disabled={input.fieldIsReadOnly}
            id="sandbox-profile-associated-resources-github-pr-settings"
            onClick={() => {
              input.onSettingsExpandedChange(!input.settingsExpanded);
            }}
            type="button"
            variant="ghost"
          >
            <span className="flex min-w-0 items-center gap-2 group-hover/button:underline group-focus-visible/button:underline">
              <span className="font-semibold">
                {input.draftEnabled ? input.selectedEventTypes.length : 0}
              </span>
              <span className="truncate">
                {createAssociatedResourceRoutingSummary({
                  selectedEventTypes: input.selectedEventTypes,
                })}
              </span>
            </span>
            {input.settingsExpanded ? (
              <CaretDownIcon className="shrink-0 transition-transform group-hover/button:scale-110 group-focus-visible/button:scale-110" />
            ) : (
              <CaretRightIcon className="shrink-0 transition-transform group-hover/button:scale-110 group-focus-visible/button:scale-110" />
            )}
          </Button>
        </FieldContent>
      </Field>
      {input.settingsExpanded ? (
        <div
          className="-mt-2 flex flex-col gap-4 md:ml-44"
          id="sandbox-profile-associated-resources-github-pr-settings-panel"
        >
          <AssociatedResourceEventTypeRows
            eventOptions={input.eventOptions}
            fieldIsReadOnly={input.fieldIsReadOnly}
            eventParameterRules={input.eventParameterRules}
            onEventParameterRuleChange={input.onEventParameterRuleChange}
            onEventParameterRulesChange={input.onEventParameterRulesChange}
            onEventTypeChange={input.onEventTypeChange}
            selectedConnectionId={input.selectedConnectionId}
            selectedEventTypes={input.selectedEventTypes}
          />
        </div>
      ) : null}
    </div>
  );
}

function AssociatedResourceEventTypeRows(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  fieldIsReadOnly: boolean;
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
  onEventParameterRuleChange: (input: {
    triggerId: string;
    parameterId: string;
    rule: WebhookTriggerEventParameterRule;
  }) => void;
  onEventParameterRulesChange: (input: {
    triggerId: string;
    rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
  }) => void;
  onEventTypeChange: (eventType: AssociatedResourceEventType, checked: boolean) => void;
  selectedConnectionId?: string | undefined;
  selectedEventTypes: readonly AssociatedResourceEventType[];
}): React.JSX.Element {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
      {GitHubPullRequestEventOptions.map((option) => {
        const selected = input.selectedEventTypes.includes(option.eventType);
        const eventOption = input.eventOptions.find(
          (candidate) => candidate.id === option.eventType,
        );

        return (
          <div className="px-3 py-3" key={option.eventType}>
            <label className="flex min-h-7 items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={selected}
                disabled={input.fieldIsReadOnly}
                onCheckedChange={(checked) => {
                  input.onEventTypeChange(option.eventType, checked === true);
                }}
              />
              <span>{option.label}</span>
            </label>
            {selected && eventOption !== undefined ? (
              <div className="mt-3 pl-6">
                <WebhookTriggerEventPicker
                  error={undefined}
                  disabledState={
                    input.fieldIsReadOnly
                      ? {
                          reason: "Agent PR activity is read-only.",
                          variant: "default",
                        }
                      : null
                  }
                  eventOptions={[eventOption]}
                  eventParameterRules={input.eventParameterRules}
                  hasConnectedIntegrations={true}
                  onEventParameterRuleChange={input.onEventParameterRuleChange}
                  onEventParameterRulesChange={input.onEventParameterRulesChange}
                  selectedConnectionId={input.selectedConnectionId ?? ""}
                  selectedEventIds={[option.eventType]}
                  selectedEventPresentation="parameters-only"
                  showAddTriggerControl={false}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function createAssociatedResourceRoutingSummary(input: {
  selectedEventTypes: readonly AssociatedResourceEventType[];
}): string {
  const activityLabel = input.selectedEventTypes.length === 1 ? "activity" : "activities";
  return `${activityLabel} selected`;
}

function createAssociatedResourceRoutingFieldGroupStateKey(input: {
  config: AssociatedResourceRoutingConfig;
  supportedAssociatedResourceEvents: readonly AssociatedResourceEventDefinition[];
}): string {
  return JSON.stringify({
    config: input.config,
    supportedAssociatedResourceEvents: input.supportedAssociatedResourceEvents,
  });
}

function createAssociatedResourceRoutingDraft(input: {
  config: AssociatedResourceRoutingConfig;
  eventOptions: readonly WebhookTriggerEventOption[];
  hasGitHubBinding: boolean;
}): AssociatedResourceRoutingDraft {
  const pullRequestRule = input.config.resources?.find(
    (resource) => resource.resourceKind === AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
  );
  const enabled =
    input.config.enabled ??
    (input.config.resources === undefined ? input.hasGitHubBinding : pullRequestRule !== undefined);
  const defaultEventTypes =
    !enabled || pullRequestRule === undefined
      ? enabled
        ? AllGitHubPullRequestEventTypes
        : []
      : pullRequestRule.eventTypes;
  const payloadFilter = pullRequestRule?.payloadFilter ?? null;
  const extractedParameterRules = extractWebhookTriggerEventParameterRules({
    eventOptions: input.eventOptions,
    selectedEventIds: defaultEventTypes,
    payloadFilter,
  });

  return {
    enabled,
    advancedPayloadFilter: extractedParameterRules.remainingPayloadFilter,
    eventTypes: sortAssociatedResourceEventTypes(defaultEventTypes),
    eventParameterRules: extractedParameterRules.eventParameterRules,
  };
}

function createAssociatedResourceRoutingConfig(
  draft: AssociatedResourceRoutingDraft,
  eventOptions: readonly WebhookTriggerEventOption[],
): AssociatedResourceRoutingConfig {
  if (!draft.enabled || draft.eventTypes.length === 0) {
    return {
      enabled: false,
      resources: [],
    };
  }

  return {
    enabled: true,
    resources: [
      {
        resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
        eventTypes: sortAssociatedResourceEventTypes(draft.eventTypes),
        ...createAssociatedResourceRoutingPayloadFilterField({ draft, eventOptions }),
      },
    ],
  };
}

function createAssociatedResourceRoutingPayloadFilterField(input: {
  draft: AssociatedResourceRoutingDraft;
  eventOptions: readonly WebhookTriggerEventOption[];
}): { payloadFilter: Record<string, unknown> } | Record<string, never> {
  const mergedPayloadFilter = mergeWebhookTriggerPayloadFilter({
    eventOptions: input.eventOptions,
    selectedEventIds: input.draft.eventTypes,
    eventParameterRules: input.draft.eventParameterRules,
    advancedPayloadFilter: input.draft.advancedPayloadFilter,
  });
  const preservedAdvancedPayloadFilter =
    createPreservedAssociatedResourceRoutingAdvancedPayloadFilter({
      advancedPayloadFilter: input.draft.advancedPayloadFilter,
      eventOptions: input.eventOptions,
      selectedEventTypes: input.draft.eventTypes,
    });
  const payloadFilter = {
    ...preservedAdvancedPayloadFilter,
    ...(mergedPayloadFilter ?? {}),
  };

  return Object.keys(payloadFilter).length === 0 ? {} : { payloadFilter };
}

function createPreservedAssociatedResourceRoutingAdvancedPayloadFilter(input: {
  advancedPayloadFilter: Record<string, unknown> | null;
  eventOptions: readonly WebhookTriggerEventOption[];
  selectedEventTypes: readonly AssociatedResourceEventType[];
}): Record<string, unknown> {
  if (input.advancedPayloadFilter === null) {
    return {};
  }

  const selectedEventTypes = new Set<string>(input.selectedEventTypes);
  const supportedEventTypes = new Set(
    input.eventOptions.map((eventOption) => eventOption.eventType),
  );
  const preservedPayloadFilter: Record<string, unknown> = {};
  for (const [eventType, payloadFilter] of Object.entries(input.advancedPayloadFilter)) {
    if (selectedEventTypes.has(eventType) && !supportedEventTypes.has(eventType)) {
      preservedPayloadFilter[eventType] = payloadFilter;
    }
  }

  return preservedPayloadFilter;
}

function associatedResourceRoutingDraftsAreEqual(
  left: AssociatedResourceRoutingDraft,
  right: AssociatedResourceRoutingDraft,
): boolean {
  return (
    left.enabled === right.enabled &&
    left.eventTypes.length === right.eventTypes.length &&
    left.eventTypes.every((eventType, index) => eventType === right.eventTypes[index]) &&
    JSON.stringify(left.eventParameterRules) === JSON.stringify(right.eventParameterRules) &&
    JSON.stringify(left.advancedPayloadFilter) === JSON.stringify(right.advancedPayloadFilter)
  );
}

function sortAssociatedResourceEventTypes(
  eventTypes: readonly AssociatedResourceEventType[],
): AssociatedResourceEventType[] {
  const order = new Map(
    AllGitHubPullRequestEventTypes.map((eventType, index) => [eventType, index]),
  );
  return [...new Set(eventTypes)].sort(
    (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
  );
}

function createAssociatedResourceEventOptions(input: {
  supportedAssociatedResourceEvents: readonly AssociatedResourceEventDefinition[];
}): WebhookTriggerEventOption[] {
  return input.supportedAssociatedResourceEvents
    .filter(
      (eventDefinition) =>
        eventDefinition.resourceKind === AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
    )
    .map((eventDefinition) => ({
      id: eventDefinition.eventType,
      eventType: eventDefinition.eventType,
      integrationWebhookSourceId: "associated-resource-routing",
      connectionId: "associated-resource-routing",
      connectionLabel: "Associated resource routing",
      label: eventDefinition.displayName,
      ...(eventDefinition.parameters === undefined
        ? {}
        : {
            parameters: eventDefinition.parameters.map(
              cloneAssociatedResourceEventParameterDefinition,
            ),
          }),
      ...(eventDefinition.parameterGroups === undefined
        ? {}
        : {
            parameterGroups: eventDefinition.parameterGroups.map(
              cloneAssociatedResourceEventParameterGroupDefinition,
            ),
          }),
    }));
}

function cloneAssociatedResourceEventParameterDefinition(
  parameter: AssociatedResourceEventParameterDefinition,
): WebhookTriggerEventParameterOption {
  switch (parameter.kind) {
    case "resource-select":
      return {
        id: parameter.id,
        label: parameter.label,
        kind: parameter.kind,
        resourceKind: parameter.resourceKind,
        payloadPath: [...parameter.payloadPath],
        ...(parameter.negatedMatchRequiresExists === undefined
          ? {}
          : { negatedMatchRequiresExists: parameter.negatedMatchRequiresExists }),
        ...(parameter.prefix === undefined ? {} : { prefix: parameter.prefix }),
        ...(parameter.placeholder === undefined ? {} : { placeholder: parameter.placeholder }),
      };
    case "string":
      return {
        id: parameter.id,
        label: parameter.label,
        kind: parameter.kind,
        payloadPath: [...parameter.payloadPath],
        ...(parameter.matchMode === undefined ? {} : { matchMode: parameter.matchMode }),
        ...(parameter.controlVariant === undefined
          ? {}
          : { controlVariant: parameter.controlVariant }),
        ...(parameter.negatedMatchRequiresExists === undefined
          ? {}
          : { negatedMatchRequiresExists: parameter.negatedMatchRequiresExists }),
        ...(parameter.prefix === undefined ? {} : { prefix: parameter.prefix }),
        ...(parameter.placeholder === undefined ? {} : { placeholder: parameter.placeholder }),
      };
    case "enum-select":
      return {
        id: parameter.id,
        label: parameter.label,
        kind: parameter.kind,
        payloadPath: [...parameter.payloadPath],
        matchMode: parameter.matchMode,
        options: parameter.options.map((option) => ({
          value: option.value,
          label: option.label,
        })),
        ...(parameter.negatedMatchRequiresExists === undefined
          ? {}
          : { negatedMatchRequiresExists: parameter.negatedMatchRequiresExists }),
        ...(parameter.prefix === undefined ? {} : { prefix: parameter.prefix }),
        ...(parameter.placeholder === undefined ? {} : { placeholder: parameter.placeholder }),
      };
  }
}

function cloneAssociatedResourceEventParameterGroupDefinition(
  parameterGroup: AssociatedResourceEventParameterGroupDefinition,
): WebhookTriggerEventParameterGroup {
  return {
    id: parameterGroup.id,
    label: parameterGroup.label,
    kind: parameterGroup.kind,
    options: parameterGroup.options.map((option) => ({
      parameterId: option.parameterId,
      label: option.label,
    })),
  };
}
