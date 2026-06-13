import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
  SlackThreadMessageModes,
  type AssociatedProviderResourceKind,
  type AssociatedResourceEventType,
  type SlackThreadMessageMode,
} from "@mistle/integrations-core";
import {
  Button,
  Checkbox,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabelWithTooltip,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import { CaretDownIcon, CaretRightIcon, InfoIcon } from "@phosphor-icons/react";
import { useCallback, useState, type ReactNode } from "react";

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
  WebhookTriggerEventParameterRuleOperators,
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

const SlackThreadEventOptions: ReadonlyArray<{
  eventType: AssociatedResourceEventType;
  label: string;
}> = [
  {
    eventType: AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED,
    label: "Thread messages",
  },
];

const AllSlackThreadEventTypes = SlackThreadEventOptions.map((option) => option.eventType);

const AssociatedResourceOptions: ReadonlyArray<{
  defaultEventTypes: readonly AssociatedResourceEventType[];
  label: string;
  resourceKind: AssociatedProviderResourceKind;
  tooltip: string;
  tooltipLabel: string;
}> = [
  {
    defaultEventTypes: AllGitHubPullRequestEventTypes,
    label: "Agent PR activity",
    resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
    tooltip: "Send selected GitHub activity back to the agent that opened the PR.",
    tooltipLabel: "Explain agent PR activity",
  },
  {
    defaultEventTypes: AllSlackThreadEventTypes,
    label: "Agent-started Slack threads",
    resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
    tooltip: "Send replies in agent-started Slack threads back to the originating agent.",
    tooltipLabel: "Explain agent-started Slack threads",
  },
];

type AssociatedResourceRoutingConfig =
  SandboxProfileVersion["associatedResourceEventRoutingConfig"];
type AssociatedResourceRoutingLayout = "horizontal" | "vertical";
type AssociatedResourceEventDefinition = NonNullable<
  IntegrationTarget["supportedAssociatedResourceEvents"]
>[number];
type AssociatedResourceEventParameterDefinition = NonNullable<
  AssociatedResourceEventDefinition["parameters"]
>[number];
type AssociatedResourceEventParameterGroupDefinition = NonNullable<
  AssociatedResourceEventDefinition["parameterGroups"]
>[number];

type AssociatedResourceRoutingResourceRule = NonNullable<
  AssociatedResourceRoutingConfig["resources"]
>[number];

type GitHubPullRequestAssociatedResourceEventType = Extract<
  AssociatedResourceRoutingResourceRule,
  { resourceKind: typeof AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST }
>["eventTypes"][number];

type SlackThreadAssociatedResourceEventType =
  typeof AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED;

type AssociatedResourceRoutingReadOnlyDetail = {
  id: string;
  label: ReactNode;
  value: ReactNode;
};

type AssociatedResourceRoutingDraft = {
  resources: AssociatedResourceRoutingResourceDraft[];
};

type AssociatedResourceRoutingResourceDraft = {
  enabled: boolean;
  eventTypes: AssociatedResourceEventType[];
  resourceKind: AssociatedProviderResourceKind;
  advancedPayloadFilter: Record<string, unknown> | null;
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
  slackThreadMessageMode: SlackThreadMessageMode;
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
  hasSlackThreadBinding: boolean;
  isDraft: boolean;
  layout?: AssociatedResourceRoutingLayout | undefined;
  onDraftStateChange?: (state: SandboxProfileAssociatedResourceRoutingDraftState) => void;
  resourceKinds?: readonly AssociatedProviderResourceKind[] | undefined;
  selectedConnectionId?: string | undefined;
  supportedAssociatedResourceEvents?: readonly AssociatedResourceEventDefinition[] | undefined;
  version: SandboxProfileVersion;
}): React.JSX.Element {
  const remountKey = createAssociatedResourceRoutingFieldGroupStateKey({
    config: input.version.associatedResourceEventRoutingConfig,
    hasGitHubBinding: input.hasGitHubBinding,
    hasSlackThreadBinding: input.hasSlackThreadBinding,
    resourceKinds: input.resourceKinds,
    supportedAssociatedResourceEvents: input.supportedAssociatedResourceEvents ?? [],
  });

  return (
    <SandboxProfileAssociatedResourceRoutingStatefulSection
      disabled={input.disabled}
      hasGitHubBinding={input.hasGitHubBinding}
      hasSlackThreadBinding={input.hasSlackThreadBinding}
      isDraft={input.isDraft}
      layout={input.layout ?? "horizontal"}
      key={remountKey}
      {...(input.onDraftStateChange === undefined
        ? {}
        : { onDraftStateChange: input.onDraftStateChange })}
      resourceKinds={input.resourceKinds}
      selectedConnectionId={input.selectedConnectionId}
      supportedAssociatedResourceEvents={input.supportedAssociatedResourceEvents}
      version={input.version}
    />
  );
}

function SandboxProfileAssociatedResourceRoutingStatefulSection(input: {
  disabled: boolean;
  hasGitHubBinding: boolean;
  hasSlackThreadBinding: boolean;
  isDraft: boolean;
  layout: AssociatedResourceRoutingLayout;
  onDraftStateChange?: (state: SandboxProfileAssociatedResourceRoutingDraftState) => void;
  resourceKinds?: readonly AssociatedProviderResourceKind[] | undefined;
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
    hasSlackThreadBinding: input.hasSlackThreadBinding,
  });
  const [draft, setDraft] = useState<AssociatedResourceRoutingDraft>(initialDraft);
  const [persistedDraft, setPersistedDraft] =
    useState<AssociatedResourceRoutingDraft>(initialDraft);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [expandedResourceKinds, setExpandedResourceKinds] = useState<
    AssociatedProviderResourceKind[]
  >([]);
  const fieldIsReadOnly = input.disabled || !input.isDraft;

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
        hasSlackThreadBinding: input.hasSlackThreadBinding,
      });
      setDraft(nextDraft);
      setPersistedDraft(nextDraft);
      setSaveErrorMessage(null);
      input.onDraftStateChange?.({
        hasUnpersistedChanges: false,
      });
    },
    [eventOptions, input.hasGitHubBinding, input.hasSlackThreadBinding, input.onDraftStateChange],
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

  function updateEventType(
    resourceKind: AssociatedProviderResourceKind,
    eventType: AssociatedResourceEventType,
    checked: boolean,
  ): void {
    const resourceDraft = draft.resources.find(
      (resource) => resource.resourceKind === resourceKind,
    );
    if (fieldIsReadOnly || resourceDraft === undefined) {
      return;
    }

    const nextEventTypes = checked
      ? [...new Set([...resourceDraft.eventTypes, eventType])]
      : resourceDraft.eventTypes.filter((selectedEventType) => selectedEventType !== eventType);
    const sortedEventTypes = sortAssociatedResourceEventTypes(nextEventTypes);

    updateDraft(
      updateResourceDraft(draft, resourceKind, (currentResourceDraft) => ({
        ...currentResourceDraft,
        enabled: sortedEventTypes.length > 0,
        eventTypes: sortedEventTypes,
      })),
    );
  }

  function updateSlackThreadMessageEnabled(checked: boolean): void {
    if (fieldIsReadOnly) {
      return;
    }

    updateDraft(
      updateResourceDraft(draft, AssociatedProviderResourceKinds.SLACK_THREAD, (resourceDraft) => ({
        ...resourceDraft,
        enabled: checked,
        eventTypes: checked ? [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED] : [],
      })),
    );
  }

  function updateSlackThreadMessageMode(messageMode: SlackThreadMessageMode): void {
    if (fieldIsReadOnly) {
      return;
    }

    updateDraft(
      updateResourceDraft(draft, AssociatedProviderResourceKinds.SLACK_THREAD, (resourceDraft) => ({
        ...resourceDraft,
        slackThreadMessageMode: messageMode,
      })),
    );
  }

  function updateEventParameterRule(input: {
    resourceKind: AssociatedProviderResourceKind;
    triggerId: string;
    parameterId: string;
    rule: WebhookTriggerEventParameterRule;
  }): void {
    if (fieldIsReadOnly) {
      return;
    }

    updateDraft(
      updateResourceDraft(draft, input.resourceKind, (resourceDraft) => ({
        ...resourceDraft,
        eventParameterRules: {
          ...resourceDraft.eventParameterRules,
          [input.triggerId]: {
            ...(resourceDraft.eventParameterRules[input.triggerId] ?? {}),
            [input.parameterId]: input.rule,
          },
        },
      })),
    );
  }

  function updateEventParameterRules(input: {
    resourceKind: AssociatedProviderResourceKind;
    triggerId: string;
    rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
  }): void {
    if (fieldIsReadOnly) {
      return;
    }

    updateDraft(
      updateResourceDraft(draft, input.resourceKind, (resourceDraft) => ({
        ...resourceDraft,
        eventParameterRules: {
          ...resourceDraft.eventParameterRules,
          [input.triggerId]: input.rules,
        },
      })),
    );
  }

  return (
    <SandboxProfileAssociatedResourceRoutingFields
      eventOptions={eventOptions}
      fieldIsReadOnly={fieldIsReadOnly}
      onEventParameterRuleChange={updateEventParameterRule}
      onEventParameterRulesChange={updateEventParameterRules}
      onEventTypeChange={updateEventType}
      onSettingsExpandedChange={updateSettingsExpanded}
      onSlackThreadMessageEnabledChange={updateSlackThreadMessageEnabled}
      onSlackThreadMessageModeChange={updateSlackThreadMessageMode}
      layout={input.layout}
      resourceKinds={input.resourceKinds}
      resources={draft.resources}
      saveErrorMessage={saveErrorMessage}
      selectedConnectionId={input.selectedConnectionId}
      expandedResourceKinds={expandedResourceKinds}
    />
  );

  function updateSettingsExpanded(
    resourceKind: AssociatedProviderResourceKind,
    expanded: boolean,
  ): void {
    setExpandedResourceKinds((currentResourceKinds) => {
      if (expanded) {
        return [...new Set([...currentResourceKinds, resourceKind])];
      }

      return currentResourceKinds.filter(
        (currentResourceKind) => currentResourceKind !== resourceKind,
      );
    });
  }
}

function SandboxProfileAssociatedResourceRoutingFields(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  fieldIsReadOnly: boolean;
  onEventParameterRuleChange: (input: {
    resourceKind: AssociatedProviderResourceKind;
    triggerId: string;
    parameterId: string;
    rule: WebhookTriggerEventParameterRule;
  }) => void;
  onEventParameterRulesChange: (input: {
    resourceKind: AssociatedProviderResourceKind;
    triggerId: string;
    rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
  }) => void;
  onEventTypeChange: (
    resourceKind: AssociatedProviderResourceKind,
    eventType: AssociatedResourceEventType,
    checked: boolean,
  ) => void;
  onSettingsExpandedChange: (
    resourceKind: AssociatedProviderResourceKind,
    expanded: boolean,
  ) => void;
  layout: AssociatedResourceRoutingLayout;
  onSlackThreadMessageEnabledChange: (checked: boolean) => void;
  onSlackThreadMessageModeChange: (messageMode: SlackThreadMessageMode) => void;
  resourceKinds?: readonly AssociatedProviderResourceKind[] | undefined;
  resources: readonly AssociatedResourceRoutingResourceDraft[];
  saveErrorMessage: string | null;
  selectedConnectionId?: string | undefined;
  expandedResourceKinds: readonly AssociatedProviderResourceKind[];
}): React.JSX.Element {
  return (
    <div className={`flex flex-col gap-4 ${input.layout === "vertical" ? "pt-2" : ""}`}>
      {input.saveErrorMessage === null ? null : (
        <Notice title={input.saveErrorMessage} variant="alert" />
      )}
      {AssociatedResourceOptions.map((option) => {
        if (
          input.resourceKinds !== undefined &&
          !input.resourceKinds.includes(option.resourceKind)
        ) {
          return null;
        }

        const resource = input.resources.find(
          (candidate) => candidate.resourceKind === option.resourceKind,
        );
        if (resource === undefined) {
          return null;
        }
        const settingsExpanded = input.expandedResourceKinds.includes(option.resourceKind);
        return (
          <div className="grid gap-2" key={option.resourceKind}>
            <Field contentWidth="fill" orientation={input.layout}>
              <FieldHeader>
                <FieldLabelWithTooltip tooltip={option.tooltip} tooltipLabel={option.tooltipLabel}>
                  {option.label}
                </FieldLabelWithTooltip>
              </FieldHeader>
              <FieldContent>
                <AssociatedResourceSettingsButton
                  fieldIsReadOnly={input.fieldIsReadOnly}
                  label={option.label}
                  layout={input.layout}
                  onSettingsExpandedChange={(expanded) => {
                    input.onSettingsExpandedChange(option.resourceKind, expanded);
                  }}
                  resource={resource}
                  settingsExpanded={settingsExpanded}
                />
              </FieldContent>
            </Field>
            {option.resourceKind === AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST ? (
              <GitHubPullRequestSettings
                eventOptions={input.eventOptions}
                fieldIsReadOnly={input.fieldIsReadOnly}
                onEventParameterRuleChange={(change) => {
                  input.onEventParameterRuleChange({
                    resourceKind: option.resourceKind,
                    ...change,
                  });
                }}
                onEventParameterRulesChange={(change) => {
                  input.onEventParameterRulesChange({
                    resourceKind: option.resourceKind,
                    ...change,
                  });
                }}
                onEventTypeChange={(eventType, checked) => {
                  input.onEventTypeChange(option.resourceKind, eventType, checked);
                }}
                resource={resource}
                selectedConnectionId={input.selectedConnectionId}
                settingsExpanded={settingsExpanded}
                layout={input.layout}
              />
            ) : (
              <SlackThreadSettings
                eventOptions={input.eventOptions}
                fieldIsReadOnly={input.fieldIsReadOnly}
                onEventParameterRuleChange={(change) => {
                  input.onEventParameterRuleChange({
                    resourceKind: option.resourceKind,
                    ...change,
                  });
                }}
                onEventParameterRulesChange={(change) => {
                  input.onEventParameterRulesChange({
                    resourceKind: option.resourceKind,
                    ...change,
                  });
                }}
                onMessageEnabledChange={input.onSlackThreadMessageEnabledChange}
                onMessageModeChange={input.onSlackThreadMessageModeChange}
                resource={resource}
                selectedConnectionId={input.selectedConnectionId}
                settingsExpanded={settingsExpanded}
                layout={input.layout}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function GitHubPullRequestSettings(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  fieldIsReadOnly: boolean;
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
  resource: AssociatedResourceRoutingResourceDraft;
  selectedConnectionId?: string | undefined;
  settingsExpanded: boolean;
  layout: AssociatedResourceRoutingLayout;
}): React.JSX.Element {
  if (!input.settingsExpanded) {
    return <></>;
  }

  if (input.fieldIsReadOnly) {
    return (
      <div className={input.layout === "horizontal" ? "grid gap-2 md:ml-44" : "grid gap-2"}>
        <AssociatedResourceReadOnlySettings
          advancedPayloadFilter={input.resource.advancedPayloadFilter}
          eventOptions={input.eventOptions}
          eventParameterRules={input.resource.eventParameterRules}
          eventTypeOptions={GitHubPullRequestEventOptions}
          selectedEventTypes={input.resource.enabled ? input.resource.eventTypes : []}
          id={getAssociatedResourceSettingsPanelId(input.resource.resourceKind)}
        />
      </div>
    );
  }

  return (
    <div className={input.layout === "horizontal" ? "grid gap-2 md:ml-44" : "grid gap-2"}>
      <div
        className="flex flex-col gap-4"
        id={getAssociatedResourceSettingsPanelId(input.resource.resourceKind)}
      >
        <AssociatedResourceEventTypeRows
          eventOptions={input.eventOptions}
          eventParameterRules={input.resource.eventParameterRules}
          eventTypeOptions={GitHubPullRequestEventOptions}
          onEventParameterRuleChange={input.onEventParameterRuleChange}
          onEventParameterRulesChange={input.onEventParameterRulesChange}
          onEventTypeChange={input.onEventTypeChange}
          selectedConnectionId={input.selectedConnectionId}
          selectedEventTypes={input.resource.enabled ? input.resource.eventTypes : []}
        />
      </div>
    </div>
  );
}

function AssociatedResourceSettingsButton(input: {
  fieldIsReadOnly: boolean;
  label: string;
  layout: AssociatedResourceRoutingLayout;
  onSettingsExpandedChange: (expanded: boolean) => void;
  resource: AssociatedResourceRoutingResourceDraft;
  settingsExpanded: boolean;
}): React.JSX.Element {
  const summaryClassName =
    input.layout === "horizontal" ? "flex min-h-10 items-center" : "flex items-center";

  if (
    input.fieldIsReadOnly &&
    (!input.resource.enabled || input.resource.eventTypes.length === 0)
  ) {
    return (
      <span className={`${summaryClassName} text-foreground w-fit min-w-0 text-sm`}>
        <span className="min-w-0 truncate">
          <span>0</span>{" "}
          {createAssociatedResourceRoutingSummary({
            resource: input.resource,
          })}
        </span>
      </span>
    );
  }

  return (
    <Button
      aria-controls={getAssociatedResourceSettingsPanelId(input.resource.resourceKind)}
      aria-expanded={input.settingsExpanded}
      aria-label={`Configure ${input.label}`}
      className={`${summaryClassName} group/button text-foreground hover:text-primary focus-visible:text-primary h-auto w-fit min-w-0 justify-start gap-2 px-0 py-0 text-sm font-normal hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-foreground`}
      id={getAssociatedResourceSettingsButtonId(input.resource.resourceKind)}
      onClick={() => {
        input.onSettingsExpandedChange(!input.settingsExpanded);
      }}
      type="button"
      variant="ghost"
    >
      <span className="min-w-0 truncate group-hover/button:underline group-focus-visible/button:underline">
        <span>{input.resource.enabled ? input.resource.eventTypes.length : 0}</span>{" "}
        {createAssociatedResourceRoutingSummary({
          resource: input.resource,
        })}
      </span>
      {input.settingsExpanded ? (
        <CaretDownIcon className="shrink-0 transition-transform group-hover/button:scale-110 group-focus-visible/button:scale-110" />
      ) : (
        <CaretRightIcon className="shrink-0 transition-transform group-hover/button:scale-110 group-focus-visible/button:scale-110" />
      )}
    </Button>
  );
}

function AssociatedResourceEventTypeRows(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
  eventTypeOptions: ReadonlyArray<{
    eventType: AssociatedResourceEventType;
    label: string;
  }>;
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
    <div className="divide-border border-border divide-y overflow-hidden rounded-md border">
      {input.eventTypeOptions.map((option) => {
        const selected = input.selectedEventTypes.includes(option.eventType);
        const eventOption = input.eventOptions.find(
          (candidate) => candidate.id === option.eventType,
        );

        return (
          <div className="px-3 py-3" key={option.eventType}>
            <label className="flex min-h-7 items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={selected}
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

function AssociatedResourceReadOnlySettings(input: {
  advancedPayloadFilter: Record<string, unknown> | null;
  eventOptions: readonly WebhookTriggerEventOption[];
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
  eventTypeOptions: ReadonlyArray<{
    eventType: AssociatedResourceEventType;
    label: string;
  }>;
  id?: string | undefined;
  selectedEventTypes: readonly AssociatedResourceEventType[];
}): React.JSX.Element {
  const selectedOptions = input.eventTypeOptions.filter((option) =>
    input.selectedEventTypes.includes(option.eventType),
  );

  return (
    <div
      className="divide-border border-border divide-y overflow-hidden rounded-md border"
      {...(input.id === undefined ? {} : { id: input.id })}
    >
      {selectedOptions.length === 0 ? (
        <p className="text-muted-foreground px-3 py-3 text-sm">No activities selected.</p>
      ) : (
        selectedOptions.map((option) => {
          const eventOption = input.eventOptions.find(
            (candidate) => candidate.id === option.eventType,
          );
          const details = [
            ...(eventOption === undefined
              ? []
              : createReadOnlyEventParameterDetails({
                  eventOption,
                  rules: input.eventParameterRules[option.eventType] ?? {},
                })),
            ...createReadOnlyAdvancedFilterDetails({
              advancedPayloadFilter: input.advancedPayloadFilter,
              eventType: option.eventType,
            }),
          ];

          return (
            <div className="px-3 py-3" key={option.eventType}>
              <p className="text-sm font-medium">{option.label}</p>
              <AssociatedResourceReadOnlyDetailRows className="mt-1.5" details={details} />
            </div>
          );
        })
      )}
    </div>
  );
}

function AssociatedResourceReadOnlyDetailRows(input: {
  className?: string | undefined;
  details: readonly AssociatedResourceRoutingReadOnlyDetail[];
}): React.JSX.Element | null {
  if (input.details.length === 0) {
    return null;
  }

  return (
    <dl className={`grid gap-1.5 ${input.className ?? ""}`}>
      {input.details.map((detail) => (
        <div className="flex w-full items-center gap-4" key={detail.id}>
          <dt className="text-muted-foreground shrink-0 text-sm whitespace-nowrap">
            {detail.label}
          </dt>
          <dd className="min-w-0 text-sm break-words">{detail.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function createReadOnlyEventParameterDetails(input: {
  eventOption: WebhookTriggerEventOption;
  rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
}): AssociatedResourceRoutingReadOnlyDetail[] {
  const parameters = input.eventOption.parameters ?? [];
  const parameterGroups = input.eventOption.parameterGroups ?? [];
  const renderedGroupIds = new Set<string>();

  return parameters.flatMap((parameter) => {
    const parameterGroup = findReadOnlyParameterGroupForParameter({
      groups: parameterGroups,
      parameterId: parameter.id,
    });

    if (parameterGroup !== undefined) {
      if (renderedGroupIds.has(parameterGroup.id)) {
        return [];
      }

      renderedGroupIds.add(parameterGroup.id);
      return createReadOnlyParameterGroupDetails({
        group: parameterGroup,
        parameters,
        rules: input.rules,
      });
    }

    const rule = input.rules[parameter.id];
    if (rule === undefined) {
      return [];
    }

    return [
      {
        id: parameter.id,
        label: formatReadOnlyEventParameterLabel({ parameter, rule }),
        value: formatWebhookTriggerEventParameterRuleValue({ parameter, rule }),
      },
    ];
  });
}

function findReadOnlyParameterGroupForParameter(input: {
  groups: readonly WebhookTriggerEventParameterGroup[];
  parameterId: string;
}): WebhookTriggerEventParameterGroup | undefined {
  return input.groups.find((group) =>
    group.options.some((option) => option.parameterId === input.parameterId),
  );
}

function createReadOnlyParameterGroupDetails(input: {
  group: WebhookTriggerEventParameterGroup;
  parameters: readonly WebhookTriggerEventParameterOption[];
  rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
}): AssociatedResourceRoutingReadOnlyDetail[] {
  const selectedOption = input.group.options.find((option) => {
    const rule = input.rules[option.parameterId];
    return (rule?.value.trim().length ?? 0) > 0;
  });

  if (selectedOption === undefined) {
    return [];
  }

  const parameter = input.parameters.find(
    (candidate) => candidate.id === selectedOption.parameterId,
  );
  const rule = input.rules[selectedOption.parameterId];
  if (parameter === undefined || rule === undefined) {
    return [];
  }

  return [
    {
      id: input.group.id,
      label: `${selectedOption.label} ${formatReadOnlyEqualityOperatorLabel({
        includePrefix: false,
        operator: resolveReadOnlyEqualityOperator(rule),
        parameter,
      })}`,
      value: formatWebhookTriggerEventParameterRuleValue({ parameter, rule }),
    },
  ];
}

function createReadOnlyAdvancedFilterDetails(input: {
  advancedPayloadFilter: Record<string, unknown> | null;
  eventType: AssociatedResourceEventType;
}): AssociatedResourceRoutingReadOnlyDetail[] {
  const filter = input.advancedPayloadFilter?.[input.eventType];
  if (filter === undefined) {
    return [];
  }

  return [
    {
      id: "advanced-payload-filter",
      label: "Additional filter",
      value: (
        <code className="bg-muted block rounded px-2 py-1 text-xs whitespace-pre-wrap">
          {JSON.stringify(filter, null, 2)}
        </code>
      ),
    },
  ];
}

function formatReadOnlyEventParameterLabel(input: {
  parameter: WebhookTriggerEventParameterOption;
  rule: WebhookTriggerEventParameterRule;
}): ReactNode {
  if (
    input.parameter.kind === "string" &&
    input.parameter.controlVariant === "invocation-token" &&
    input.rule.operator === WebhookTriggerEventParameterRuleOperators.CONTAINS_TOKEN
  ) {
    return <ReadOnlyInvocationTokenFilterLabel />;
  }

  if (isReadOnlyEqualityParameter(input.parameter)) {
    return formatReadOnlyEqualityOperatorLabel({
      includePrefix: true,
      operator: resolveReadOnlyEqualityOperator(input.rule),
      parameter: input.parameter,
    });
  }

  switch (input.rule.operator) {
    case WebhookTriggerEventParameterRuleOperators.CONTAINS:
      return input.parameter.prefix ?? input.parameter.label;
    case WebhookTriggerEventParameterRuleOperators.CONTAINS_TOKEN:
      return "includes";
    case WebhookTriggerEventParameterRuleOperators.EXISTS:
      return "exists";
    case WebhookTriggerEventParameterRuleOperators.NOT_EXISTS:
      return "does not exist";
    case WebhookTriggerEventParameterRuleOperators.IS:
      return input.parameter.prefix ?? "is";
    case WebhookTriggerEventParameterRuleOperators.IS_NOT:
      return input.parameter.prefix === undefined ? "is not" : `not ${input.parameter.prefix}`;
  }
}

function ReadOnlyInvocationTokenFilterLabel(): React.JSX.Element {
  return (
    <span className="flex items-center gap-1">
      <span>includes</span>
      <Tooltip delay={0}>
        <TooltipTrigger
          aria-label="Explain invocation token filter"
          render={
            <button
              className="text-muted-foreground hover:text-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-sm"
              type="button"
            />
          }
        >
          <InfoIcon aria-hidden className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-left" side="top">
          Example: @mistlebot, mistle, /triage. Leave blank to match all events.
        </TooltipContent>
      </Tooltip>
    </span>
  );
}

function isReadOnlyEqualityParameter(parameter: WebhookTriggerEventParameterOption): boolean {
  return (
    parameter.kind === "resource-select" ||
    (parameter.kind === "string" &&
      (parameter.matchMode === undefined || parameter.matchMode === "eq")) ||
    (parameter.kind === "enum-select" && parameter.matchMode === "eq")
  );
}

function resolveReadOnlyEqualityOperator(rule: WebhookTriggerEventParameterRule): "is" | "is_not" {
  return rule.operator === WebhookTriggerEventParameterRuleOperators.IS_NOT
    ? WebhookTriggerEventParameterRuleOperators.IS_NOT
    : WebhookTriggerEventParameterRuleOperators.IS;
}

function formatReadOnlyEqualityOperatorLabel(input: {
  includePrefix: boolean;
  operator: "is" | "is_not";
  parameter: WebhookTriggerEventParameterOption;
}): string {
  const prefix = input.includePrefix ? input.parameter.prefix : undefined;
  if (input.operator === WebhookTriggerEventParameterRuleOperators.IS) {
    return prefix ?? "is";
  }

  return prefix === undefined ? "is not" : `not ${prefix}`;
}

function formatWebhookTriggerEventParameterRuleValue(input: {
  parameter: WebhookTriggerEventParameterOption;
  rule: WebhookTriggerEventParameterRule;
}): string {
  if (input.parameter.kind !== "enum-select") {
    return input.rule.value;
  }

  return (
    input.parameter.options.find((option) => option.value === input.rule.value)?.label ??
    input.rule.value
  );
}

function SlackThreadSettings(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  fieldIsReadOnly: boolean;
  onEventParameterRuleChange: (input: {
    triggerId: string;
    parameterId: string;
    rule: WebhookTriggerEventParameterRule;
  }) => void;
  onEventParameterRulesChange: (input: {
    triggerId: string;
    rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
  }) => void;
  onMessageEnabledChange: (checked: boolean) => void;
  onMessageModeChange: (messageMode: SlackThreadMessageMode) => void;
  resource: AssociatedResourceRoutingResourceDraft;
  selectedConnectionId?: string | undefined;
  settingsExpanded: boolean;
  layout: AssociatedResourceRoutingLayout;
}): React.JSX.Element {
  if (!input.settingsExpanded) {
    return <></>;
  }

  const eventOption = input.eventOptions.find(
    (candidate) => candidate.id === AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED,
  );
  const selected = input.resource.enabled
    ? input.resource.eventTypes.includes(AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED)
    : false;

  if (input.fieldIsReadOnly) {
    return (
      <div
        className={input.layout === "horizontal" ? "grid gap-2 md:ml-44" : "grid gap-2"}
        id={getAssociatedResourceSettingsPanelId(input.resource.resourceKind)}
      >
        <SlackThreadReadOnlySettings
          advancedPayloadFilter={input.resource.advancedPayloadFilter}
          eventOption={eventOption}
          eventParameterRules={input.resource.eventParameterRules}
          messageMode={input.resource.slackThreadMessageMode}
          selected={selected}
        />
      </div>
    );
  }

  return (
    <div
      className={input.layout === "horizontal" ? "grid gap-2 md:ml-44" : "grid gap-2"}
      id={getAssociatedResourceSettingsPanelId(input.resource.resourceKind)}
    >
      <div className="border-border rounded-md border px-3 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox
            aria-label="Enable thread messages"
            checked={selected}
            onCheckedChange={(checked) => {
              input.onMessageEnabledChange(checked === true);
            }}
          />
          <SlackThreadMessageModeField
            messageMode={input.resource.slackThreadMessageMode}
            id="slack-thread-message-selection"
            onMessageModeChange={input.onMessageModeChange}
          />
        </div>
        {selected && eventOption !== undefined ? (
          <div className="mt-3">
            <WebhookTriggerEventPicker
              error={undefined}
              eventOptions={[eventOption]}
              eventParameterRules={input.resource.eventParameterRules}
              hasConnectedIntegrations={true}
              onEventParameterRuleChange={input.onEventParameterRuleChange}
              onEventParameterRulesChange={input.onEventParameterRulesChange}
              selectedConnectionId={input.selectedConnectionId ?? ""}
              selectedEventIds={[AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED]}
              selectedEventPresentation="parameters-only"
              showAddTriggerControl={false}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SlackThreadReadOnlySettings(input: {
  advancedPayloadFilter: Record<string, unknown> | null;
  eventOption: WebhookTriggerEventOption | undefined;
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
  messageMode: SlackThreadMessageMode;
  selected: boolean;
}): React.JSX.Element {
  if (!input.selected) {
    return (
      <div className="border-border rounded-md border px-3 py-3">
        <p className="text-muted-foreground text-sm">No activities selected.</p>
      </div>
    );
  }

  const eventType = AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED;
  const details = [
    ...(input.eventOption === undefined
      ? []
      : createReadOnlyEventParameterDetails({
          eventOption: input.eventOption,
          rules: input.eventParameterRules[eventType] ?? {},
        })),
    ...createReadOnlyAdvancedFilterDetails({
      advancedPayloadFilter: input.advancedPayloadFilter,
      eventType,
    }),
  ];

  return (
    <div className="border-border rounded-md border px-3 py-3">
      <p className="text-sm font-medium">{getSlackThreadMessageModeLabel(input.messageMode)}</p>
      <AssociatedResourceReadOnlyDetailRows className="mt-2" details={details} />
    </div>
  );
}

function SlackThreadMessageModeField(input: {
  id: string;
  messageMode: SlackThreadMessageMode;
  onMessageModeChange: (messageMode: SlackThreadMessageMode) => void;
}): React.JSX.Element {
  return (
    <Select
      onValueChange={(value) => {
        if (isSlackThreadMessageMode(value)) {
          input.onMessageModeChange(value);
        }
      }}
      value={input.messageMode}
    >
      <SelectTrigger aria-label="Thread messages" className="h-9 w-48 bg-background" id={input.id}>
        <SelectValue>{getSlackThreadMessageModeLabel(input.messageMode)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SlackThreadMessageModes.ALL}>All messages</SelectItem>
        <SelectItem value={SlackThreadMessageModes.APP_MENTIONS_ONLY}>App mentions only</SelectItem>
      </SelectContent>
    </Select>
  );
}

function getAssociatedResourceSettingsButtonId(
  resourceKind: AssociatedProviderResourceKind,
): string {
  return `sandbox-profile-associated-resources-${resourceKind}-settings`;
}

function getAssociatedResourceSettingsPanelId(
  resourceKind: AssociatedProviderResourceKind,
): string {
  return `sandbox-profile-associated-resources-${resourceKind}-settings-panel`;
}

function isSlackThreadMessageMode(value: unknown): value is SlackThreadMessageMode {
  return (
    value === SlackThreadMessageModes.ALL || value === SlackThreadMessageModes.APP_MENTIONS_ONLY
  );
}

function getSlackThreadMessageModeLabel(messageMode: SlackThreadMessageMode): string {
  switch (messageMode) {
    case SlackThreadMessageModes.ALL:
      return "All messages";
    case SlackThreadMessageModes.APP_MENTIONS_ONLY:
      return "App mentions only";
  }
}

function createAssociatedResourceRoutingSummary(input: {
  resource: AssociatedResourceRoutingResourceDraft;
}): string {
  const selectedEventTypes = input.resource.enabled ? input.resource.eventTypes : [];
  const activityLabel = selectedEventTypes.length === 1 ? "activity" : "activities";
  return `${activityLabel} selected`;
}

function createAssociatedResourceRoutingFieldGroupStateKey(input: {
  config: AssociatedResourceRoutingConfig;
  hasGitHubBinding: boolean;
  hasSlackThreadBinding: boolean;
  resourceKinds?: readonly AssociatedProviderResourceKind[] | undefined;
  supportedAssociatedResourceEvents: readonly AssociatedResourceEventDefinition[];
}): string {
  return JSON.stringify({
    config: input.config,
    hasGitHubBinding: input.hasGitHubBinding,
    hasSlackThreadBinding: input.hasSlackThreadBinding,
    resourceKinds: input.resourceKinds,
    supportedAssociatedResourceEvents: input.supportedAssociatedResourceEvents,
  });
}

function createAssociatedResourceRoutingDraft(input: {
  config: AssociatedResourceRoutingConfig;
  eventOptions: readonly WebhookTriggerEventOption[];
  hasGitHubBinding: boolean;
  hasSlackThreadBinding: boolean;
}): AssociatedResourceRoutingDraft {
  return {
    resources: AssociatedResourceOptions.map((option) =>
      createAssociatedResourceRoutingResourceDraft({
        config: input.config,
        defaultEnabled:
          option.resourceKind === AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST
            ? input.hasGitHubBinding
            : input.hasSlackThreadBinding,
        eventOptions: input.eventOptions,
        option,
      }),
    ),
  };
}

function createAssociatedResourceRoutingResourceDraft(input: {
  config: AssociatedResourceRoutingConfig;
  defaultEnabled: boolean;
  eventOptions: readonly WebhookTriggerEventOption[];
  option: (typeof AssociatedResourceOptions)[number];
}): AssociatedResourceRoutingResourceDraft {
  const rule = input.config.resources?.find(
    (resource) => resource.resourceKind === input.option.resourceKind,
  );
  const eventTypes = rule === undefined ? input.option.defaultEventTypes : rule.eventTypes;
  const enabled =
    input.config.resources === undefined
      ? (input.config.enabled ?? input.defaultEnabled)
      : rule !== undefined && (input.config.enabled ?? true) && eventTypes.length > 0;
  const payloadFilter =
    rule !== undefined && "payloadFilter" in rule ? (rule.payloadFilter ?? null) : null;
  const slackThreadMessageMode =
    rule !== undefined &&
    rule.resourceKind === AssociatedProviderResourceKinds.SLACK_THREAD &&
    rule.messageMode !== undefined
      ? rule.messageMode
      : SlackThreadMessageModes.ALL;
  const extractedParameterRules = extractWebhookTriggerEventParameterRules({
    eventOptions: input.eventOptions,
    selectedEventIds: eventTypes,
    payloadFilter,
  });

  return {
    advancedPayloadFilter: extractedParameterRules.remainingPayloadFilter,
    enabled,
    eventParameterRules: extractedParameterRules.eventParameterRules,
    eventTypes: sortAssociatedResourceEventTypes(eventTypes),
    resourceKind: input.option.resourceKind,
    slackThreadMessageMode,
  };
}

function createAssociatedResourceRoutingConfig(
  draft: AssociatedResourceRoutingDraft,
  eventOptions: readonly WebhookTriggerEventOption[],
): AssociatedResourceRoutingConfig {
  const enabledResources = draft.resources.filter(
    (resource) => resource.enabled && resource.eventTypes.length > 0,
  );
  if (enabledResources.length === 0) {
    return {
      enabled: false,
      resources: [],
    };
  }

  return {
    enabled: true,
    resources: enabledResources.map((resource) =>
      createAssociatedResourceEventRoutingResourceRule({ eventOptions, resource }),
    ),
  };
}

function createAssociatedResourceEventRoutingResourceRule(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  resource: AssociatedResourceRoutingResourceDraft;
}): AssociatedResourceRoutingResourceRule {
  switch (input.resource.resourceKind) {
    case AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST:
      return {
        resourceKind: input.resource.resourceKind,
        eventTypes: sortGitHubPullRequestEventTypes(input.resource.eventTypes),
        ...createAssociatedResourceRoutingPayloadFilterField({
          draft: input.resource,
          eventOptions: input.eventOptions,
        }),
      };
    case AssociatedProviderResourceKinds.SLACK_THREAD:
      return {
        resourceKind: input.resource.resourceKind,
        eventTypes: sortSlackThreadEventTypes(input.resource.eventTypes),
        ...(input.resource.slackThreadMessageMode === SlackThreadMessageModes.ALL
          ? {}
          : { messageMode: input.resource.slackThreadMessageMode }),
        ...createAssociatedResourceRoutingPayloadFilterField({
          draft: input.resource,
          eventOptions: input.eventOptions,
        }),
      };
  }
}

function createAssociatedResourceRoutingPayloadFilterField(input: {
  draft: AssociatedResourceRoutingResourceDraft;
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
    left.resources.length === right.resources.length &&
    left.resources.every((leftResource, index) => {
      const rightResource = right.resources[index];
      return (
        rightResource !== undefined &&
        leftResource.resourceKind === rightResource.resourceKind &&
        leftResource.enabled === rightResource.enabled &&
        leftResource.eventTypes.length === rightResource.eventTypes.length &&
        leftResource.eventTypes.every(
          (eventType, eventTypeIndex) => eventType === rightResource.eventTypes[eventTypeIndex],
        ) &&
        JSON.stringify(leftResource.eventParameterRules) ===
          JSON.stringify(rightResource.eventParameterRules) &&
        JSON.stringify(leftResource.advancedPayloadFilter) ===
          JSON.stringify(rightResource.advancedPayloadFilter) &&
        leftResource.slackThreadMessageMode === rightResource.slackThreadMessageMode
      );
    })
  );
}

function sortAssociatedResourceEventTypes(
  eventTypes: readonly AssociatedResourceEventType[],
): AssociatedResourceEventType[] {
  const order = new Map(
    [...AllGitHubPullRequestEventTypes, ...AllSlackThreadEventTypes].map((eventType, index) => [
      eventType,
      index,
    ]),
  );
  return [...new Set(eventTypes)].sort(
    (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
  );
}

function sortGitHubPullRequestEventTypes(
  eventTypes: readonly AssociatedResourceEventType[],
): GitHubPullRequestAssociatedResourceEventType[] {
  const sortedEventTypes: GitHubPullRequestAssociatedResourceEventType[] = [];
  for (const eventType of sortAssociatedResourceEventTypes(eventTypes)) {
    switch (eventType) {
      case AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED:
      case AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED:
      case AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_COMMENT_CREATED:
        sortedEventTypes.push(eventType);
        break;
      case AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED:
        break;
    }
  }
  return sortedEventTypes;
}

function sortSlackThreadEventTypes(
  eventTypes: readonly AssociatedResourceEventType[],
): SlackThreadAssociatedResourceEventType[] {
  const sortedEventTypes: SlackThreadAssociatedResourceEventType[] = [];
  for (const eventType of sortAssociatedResourceEventTypes(eventTypes)) {
    switch (eventType) {
      case AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED:
        sortedEventTypes.push(eventType);
        break;
      case AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED:
      case AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED:
      case AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_COMMENT_CREATED:
        break;
    }
  }
  return sortedEventTypes;
}

function updateResourceDraft(
  draft: AssociatedResourceRoutingDraft,
  resourceKind: AssociatedProviderResourceKind,
  update: (
    resourceDraft: AssociatedResourceRoutingResourceDraft,
  ) => AssociatedResourceRoutingResourceDraft,
): AssociatedResourceRoutingDraft {
  return {
    resources: draft.resources.map((resourceDraft) => {
      if (resourceDraft.resourceKind !== resourceKind) {
        return resourceDraft;
      }

      return update(resourceDraft);
    }),
  };
}

function createAssociatedResourceEventOptions(input: {
  supportedAssociatedResourceEvents: readonly AssociatedResourceEventDefinition[];
}): WebhookTriggerEventOption[] {
  return input.supportedAssociatedResourceEvents.map((eventDefinition) => ({
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
