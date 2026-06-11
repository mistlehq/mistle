import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
  type AssociatedResourceEventType,
} from "@mistle/integrations-core";
import {
  Checkbox,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabelWithTooltip,
  Notice,
  Switch,
} from "@mistle/ui";
import { useCallback, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";

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

type AssociatedResourceRoutingDraft = {
  enabled: boolean;
  eventTypes: AssociatedResourceEventType[];
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
  version: SandboxProfileVersion;
}): React.JSX.Element {
  const remountKey = createAssociatedResourceRoutingFieldGroupStateKey({
    config: input.version.associatedResourceEventRoutingConfig,
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
      version={input.version}
    />
  );
}

function SandboxProfileAssociatedResourceRoutingStatefulSection(input: {
  disabled: boolean;
  hasGitHubBinding: boolean;
  isDraft: boolean;
  onDraftStateChange?: (state: SandboxProfileAssociatedResourceRoutingDraftState) => void;
  version: SandboxProfileVersion;
}): React.JSX.Element {
  const initialDraft = createAssociatedResourceRoutingDraft({
    config: input.version.associatedResourceEventRoutingConfig,
    hasGitHubBinding: input.hasGitHubBinding,
  });
  const [draft, setDraft] = useState<AssociatedResourceRoutingDraft>(initialDraft);
  const [persistedDraft, setPersistedDraft] =
    useState<AssociatedResourceRoutingDraft>(initialDraft);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
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
        hasGitHubBinding: input.hasGitHubBinding,
      });
      setDraft(nextDraft);
      setPersistedDraft(nextDraft);
      setSaveErrorMessage(null);
      input.onDraftStateChange?.({
        hasUnpersistedChanges: false,
      });
    },
    [input.hasGitHubBinding, input.onDraftStateChange],
  );

  function publishDraftState(nextDraft: AssociatedResourceRoutingDraft): void {
    input.onDraftStateChange?.({
      applyDraftSaveError,
      applySavedAssociatedResourceEventRoutingConfig,
      buildDraftChanges: () => createAssociatedResourceRoutingConfig(nextDraft),
      hasUnpersistedChanges: !associatedResourceRoutingDraftsAreEqual(nextDraft, persistedDraft),
    });
  }

  function updateDraft(nextDraft: AssociatedResourceRoutingDraft): void {
    setDraft(nextDraft);
    setSaveErrorMessage(null);
    publishDraftState(nextDraft);
  }

  function updateEnabled(checked: boolean): void {
    if (fieldIsReadOnly) {
      return;
    }

    updateDraft({
      enabled: checked,
      eventTypes:
        selectedEventTypes.length === 0 ? AllGitHubPullRequestEventTypes : selectedEventTypes,
    });
  }

  function updateEventType(eventType: AssociatedResourceEventType, checked: boolean): void {
    if (fieldIsReadOnly || !draft.enabled) {
      return;
    }

    const nextEventTypes = checked
      ? [...new Set([...selectedEventTypes, eventType])]
      : selectedEventTypes.filter((selectedEventType) => selectedEventType !== eventType);
    if (nextEventTypes.length === 0) {
      return;
    }

    updateDraft({
      enabled: draft.enabled,
      eventTypes: sortAssociatedResourceEventTypes(nextEventTypes),
    });
  }

  return (
    <SandboxProfileAssociatedResourceRoutingFields
      draftEnabled={draft.enabled}
      disabled={input.disabled}
      fieldIsReadOnly={fieldIsReadOnly}
      onEnabledChange={updateEnabled}
      onEventTypeChange={updateEventType}
      saveErrorMessage={saveErrorMessage}
      selectedEventTypes={selectedEventTypes}
    />
  );
}

function SandboxProfileAssociatedResourceRoutingFields(input: {
  draftEnabled: boolean;
  disabled: boolean;
  fieldIsReadOnly: boolean;
  onEnabledChange: (checked: boolean) => void;
  onEventTypeChange: (eventType: AssociatedResourceEventType, checked: boolean) => void;
  saveErrorMessage: string | null;
  selectedEventTypes: readonly AssociatedResourceEventType[];
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {input.saveErrorMessage === null ? null : (
        <Notice title={input.saveErrorMessage} variant="alert" />
      )}
      <Field contentWidth="fill" orientation="horizontal">
        <FieldHeader>
          <FieldLabelWithTooltip
            htmlFor="sandbox-profile-associated-resources-github-pr"
            tooltip="Send selected GitHub activity back to the agent that opened the PR."
            tooltipLabel="Explain agent PR activity"
          >
            Agent PR activity
          </FieldLabelWithTooltip>
        </FieldHeader>
        <FieldContent>
          {input.fieldIsReadOnly ? (
            <p className="text-sm">{input.draftEnabled ? "Enabled" : "Disabled"}</p>
          ) : (
            <div className="flex min-h-10 items-center">
              <Switch
                checked={input.draftEnabled}
                disabled={input.disabled}
                id="sandbox-profile-associated-resources-github-pr"
                onCheckedChange={input.onEnabledChange}
              />
            </div>
          )}
        </FieldContent>
      </Field>
      <div className="grid gap-2 sm:grid-cols-3">
        {GitHubPullRequestEventOptions.map((option) => (
          <label
            className="border-border flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm"
            key={option.eventType}
          >
            <Checkbox
              checked={input.selectedEventTypes.includes(option.eventType)}
              disabled={input.fieldIsReadOnly || !input.draftEnabled}
              onCheckedChange={(checked) => {
                input.onEventTypeChange(option.eventType, checked === true);
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function createAssociatedResourceRoutingFieldGroupStateKey(input: {
  config: AssociatedResourceRoutingConfig;
}): string {
  return JSON.stringify({
    config: input.config,
  });
}

function createAssociatedResourceRoutingDraft(input: {
  config: AssociatedResourceRoutingConfig;
  hasGitHubBinding: boolean;
}): AssociatedResourceRoutingDraft {
  const pullRequestRule = input.config.resources?.find(
    (resource) => resource.resourceKind === AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
  );
  const defaultEventTypes =
    pullRequestRule === undefined ? AllGitHubPullRequestEventTypes : pullRequestRule.eventTypes;
  const enabled =
    input.config.enabled ??
    (input.config.resources === undefined ? input.hasGitHubBinding : defaultEventTypes.length > 0);

  return {
    enabled,
    eventTypes: sortAssociatedResourceEventTypes(defaultEventTypes),
  };
}

function createAssociatedResourceRoutingConfig(
  draft: AssociatedResourceRoutingDraft,
): AssociatedResourceRoutingConfig {
  if (!draft.enabled) {
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
      },
    ],
  };
}

function associatedResourceRoutingDraftsAreEqual(
  left: AssociatedResourceRoutingDraft,
  right: AssociatedResourceRoutingDraft,
): boolean {
  return (
    left.enabled === right.enabled &&
    left.eventTypes.length === right.eventTypes.length &&
    left.eventTypes.every((eventType, index) => eventType === right.eventTypes[index])
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
