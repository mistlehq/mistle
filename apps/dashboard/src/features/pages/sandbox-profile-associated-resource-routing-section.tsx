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
  eventOptions: ReadonlyArray<{
    eventType: AssociatedResourceEventType;
    label: string;
  }>;
  label: string;
  resourceKind: AssociatedProviderResourceKind;
  tooltip: string;
  tooltipLabel: string;
}> = [
  {
    defaultEventTypes: AllGitHubPullRequestEventTypes,
    eventOptions: GitHubPullRequestEventOptions,
    label: "Agent PR activity",
    resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
    tooltip: "Send selected GitHub activity back to the agent that opened the PR.",
    tooltipLabel: "Explain agent PR activity",
  },
  {
    defaultEventTypes: AllSlackThreadEventTypes,
    eventOptions: SlackThreadEventOptions,
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
      disabled={input.disabled}
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
  disabled: boolean;
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
    <div className="flex flex-col gap-4">
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
                <FieldLabelWithTooltip
                  htmlFor={getAssociatedResourceSettingsButtonId(option.resourceKind)}
                  tooltip={option.tooltip}
                  tooltipLabel={option.tooltipLabel}
                >
                  {option.label}
                </FieldLabelWithTooltip>
              </FieldHeader>
              <FieldContent>
                <AssociatedResourceSettingsButton
                  fieldIsReadOnly={input.fieldIsReadOnly}
                  label={option.label}
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
                eventParameterRules={resource.eventParameterRules}
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
                eventParameterRules={resource.eventParameterRules}
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
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
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
  return (
    <div className={input.layout === "horizontal" ? "grid gap-2 md:ml-44" : "grid gap-2"}>
      {input.settingsExpanded ? (
        <div
          className="flex flex-col gap-4"
          id={getAssociatedResourceSettingsPanelId(input.resource.resourceKind)}
        >
          <AssociatedResourceEventTypeRows
            eventOptions={input.eventOptions}
            eventParameterRules={input.eventParameterRules}
            eventTypeOptions={GitHubPullRequestEventOptions}
            fieldIsReadOnly={input.fieldIsReadOnly}
            onEventParameterRuleChange={input.onEventParameterRuleChange}
            onEventParameterRulesChange={input.onEventParameterRulesChange}
            onEventTypeChange={input.onEventTypeChange}
            selectedConnectionId={input.selectedConnectionId}
            selectedEventTypes={input.resource.eventTypes}
          />
        </div>
      ) : null}
    </div>
  );
}

function AssociatedResourceSettingsButton(input: {
  fieldIsReadOnly: boolean;
  label: string;
  onSettingsExpandedChange: (expanded: boolean) => void;
  resource: AssociatedResourceRoutingResourceDraft;
  settingsExpanded: boolean;
}): React.JSX.Element {
  return (
    <Button
      aria-controls={getAssociatedResourceSettingsPanelId(input.resource.resourceKind)}
      aria-expanded={input.settingsExpanded}
      aria-label={`Configure ${input.label}`}
      className="group/button text-foreground hover:text-primary focus-visible:text-primary flex min-h-10 w-fit min-w-0 justify-start gap-2 px-0 text-sm font-medium hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-foreground"
      disabled={input.fieldIsReadOnly}
      id={getAssociatedResourceSettingsButtonId(input.resource.resourceKind)}
      onClick={() => {
        input.onSettingsExpandedChange(!input.settingsExpanded);
      }}
      type="button"
      variant="ghost"
    >
      <span className="min-w-0 truncate group-hover/button:underline group-focus-visible/button:underline">
        <span className="font-semibold">
          {input.resource.enabled ? input.resource.eventTypes.length : 0}
        </span>{" "}
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
                  disabledState={
                    input.fieldIsReadOnly
                      ? {
                          reason: "Associated resource routing is read-only.",
                          variant: "default",
                        }
                      : null
                  }
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

function SlackThreadSettings(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
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
            disabled={input.fieldIsReadOnly}
            onCheckedChange={(checked) => {
              input.onMessageEnabledChange(checked === true);
            }}
          />
          <SlackThreadMessageModeField
            fieldIsReadOnly={input.fieldIsReadOnly}
            messageMode={input.resource.slackThreadMessageMode}
            id="slack-thread-message-selection"
            onMessageModeChange={input.onMessageModeChange}
          />
        </div>
        {selected && eventOption !== undefined ? (
          <div className="mt-3">
            <WebhookTriggerEventPicker
              disabledState={
                input.fieldIsReadOnly
                  ? {
                      reason: "Associated resource routing is read-only.",
                      variant: "default",
                    }
                  : null
              }
              error={undefined}
              eventOptions={[eventOption]}
              eventParameterRules={input.eventParameterRules}
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

function SlackThreadMessageModeField(input: {
  fieldIsReadOnly: boolean;
  id: string;
  messageMode: SlackThreadMessageMode;
  onMessageModeChange: (messageMode: SlackThreadMessageMode) => void;
}): React.JSX.Element {
  return (
    <Select
      disabled={input.fieldIsReadOnly}
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
    option: (typeof AssociatedResourceOptions)[number],
  ) => AssociatedResourceRoutingResourceDraft,
): AssociatedResourceRoutingDraft {
  return {
    resources: draft.resources.map((resourceDraft) => {
      if (resourceDraft.resourceKind !== resourceKind) {
        return resourceDraft;
      }

      const option = AssociatedResourceOptions.find(
        (candidate) => candidate.resourceKind === resourceKind,
      );
      if (option === undefined) {
        return resourceDraft;
      }

      return update(resourceDraft, option);
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
