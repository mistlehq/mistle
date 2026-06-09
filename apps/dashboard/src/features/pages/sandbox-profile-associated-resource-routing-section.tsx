import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
  type AssociatedResourceEventType,
} from "@mistle/integrations-core";
import { Checkbox, Field, FieldContent, FieldHeader, FieldLabel, Notice, Switch } from "@mistle/ui";
import { useCallback, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { SandboxProfileSectionCard } from "./sandbox-profile-section-card.js";

const GitHubFamilyId = "github";

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

export function SandboxProfileAssociatedResourceRoutingSection(input: {
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  disabled: boolean;
  integrationRows: readonly SandboxProfileBindingEditorRow[];
  isDraft: boolean;
  onDraftStateChange?: (state: SandboxProfileAssociatedResourceRoutingDraftState) => void;
  version: SandboxProfileVersion;
}): React.JSX.Element {
  const hasGitHubBinding = sandboxProfileHasGitHubBinding({
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
    integrationRows: input.integrationRows,
  });
  const remountKey = createAssociatedResourceRoutingStateKey({
    config: input.version.associatedResourceEventRoutingConfig,
    hasGitHubBinding,
  });

  return (
    <SandboxProfileAssociatedResourceRoutingStatefulSection
      disabled={input.disabled}
      hasGitHubBinding={hasGitHubBinding}
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
    <SandboxProfileSectionCard>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Associated Resources</h2>
          <p className="text-muted-foreground text-sm">
            Route GitHub pull request activity back into sessions that created the PR.
          </p>
        </div>
        {saveErrorMessage === null ? null : <Notice title={saveErrorMessage} variant="alert" />}
        <Field contentWidth="fill" orientation="horizontal">
          <FieldHeader>
            <FieldLabel htmlFor="sandbox-profile-associated-resources-github-pr">
              GitHub PR routing
            </FieldLabel>
          </FieldHeader>
          <FieldContent>
            {fieldIsReadOnly ? (
              <p className="text-sm">{draft.enabled ? "Enabled" : "Disabled"}</p>
            ) : (
              <div className="flex min-h-10 items-center gap-3">
                <Switch
                  checked={draft.enabled}
                  disabled={input.disabled}
                  id="sandbox-profile-associated-resources-github-pr"
                  onCheckedChange={updateEnabled}
                />
                <p className="text-muted-foreground text-sm">
                  {input.hasGitHubBinding
                    ? "GitHub binding detected"
                    : "Add a GitHub binding to use this"}
                </p>
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
                checked={selectedEventTypes.includes(option.eventType)}
                disabled={fieldIsReadOnly || !draft.enabled}
                onCheckedChange={(checked) => {
                  updateEventType(option.eventType, checked === true);
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <div className="bg-muted/40 rounded-md border p-3">
          <p className="text-muted-foreground mb-2 text-xs font-medium uppercase">
            Delivered message preview
          </p>
          <pre className="text-foreground overflow-x-auto whitespace-pre-wrap text-xs leading-relaxed">
            {`GitHub pull request comment received.

Repository: mistlehq/mistle
Pull request: #2783 Add provider resource association delivery
Comment author: reviewer
Comment URL: https://github.com/mistlehq/mistle/pull/2783#issuecomment-123
Comment type: issue_comment

Comment:
Please route this back to the original session.`}
          </pre>
        </div>
      </div>
    </SandboxProfileSectionCard>
  );
}

function createAssociatedResourceRoutingStateKey(input: {
  config: AssociatedResourceRoutingConfig;
  hasGitHubBinding: boolean;
}): string {
  return JSON.stringify({
    config: input.config,
    hasGitHubBinding: input.hasGitHubBinding,
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

function sandboxProfileHasGitHubBinding(input: {
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  integrationRows: readonly SandboxProfileBindingEditorRow[];
}): boolean {
  return input.integrationRows.some((row) => {
    const connection = input.availableConnections.find(
      (candidate) => candidate.id === row.connectionId,
    );
    if (connection === undefined) {
      return false;
    }

    const target = input.availableTargets.find(
      (candidate) => candidate.targetKey === connection.targetKey,
    );
    return target?.familyId === GitHubFamilyId;
  });
}
