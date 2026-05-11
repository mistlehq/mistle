import { Button, Notice, ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@mistle/ui";
import { SidebarSimpleIcon, TerminalIcon } from "@phosphor-icons/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";

import type { ChatEntry } from "../chat/chat-types.js";
import { ChatComposer } from "../chat/components/chat-composer.js";
import { noopRespondToServerRequest } from "../chat/components/chat-story-support.js";
import type { SandboxProfileVersionDraftAutomationImpactAutomation } from "../sandbox-profiles/sandbox-profiles-types.js";
import type {
  SandboxProviderSummary,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { SessionComposerFixtureProps } from "../session-agents/codex/fixtures/session-fixtures.js";
import {
  createIntegrationsEditorSectionStoryQueryClient,
  seedStoryIntegrationResources,
  StoryAwsConnection,
  StoryGithubConnection,
  StoryGithubResources,
  StoryIntegrationConnections,
  StoryIntegrationTargets,
  StoryJiraConnection,
  StoryLinearConnection,
  StoryOpenAiConnection,
  StoryPlanetScaleConnection,
  StorySlackConnection,
} from "./integrations-editor-section-story-support.js";
import { resolveSandboxBaseRepositoryHandles } from "./sandbox-base-inventory-copy.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  SandboxProfileIntegrationsSetupUnavailableState,
  SandboxProfileEditorView,
  SandboxProfilePanelSection,
  SandboxProfileSetupScriptPanel,
} from "./sandbox-profile-editor-page.js";
import type { SandboxProfileEditorSection } from "./sandbox-profile-editor-sections.js";
import { SandboxProfileIntegrationsSetupSection } from "./sandbox-profile-integrations-setup-section.js";
import { mapBindingsToEditorRows } from "./sandbox-profile-integrations-state.js";
import { SandboxProfileRuntimeSection } from "./sandbox-profile-runtime-section.js";
import {
  SandboxProfileSetupScriptTestButton,
  SandboxProfileSetupScriptTestPanel,
  type SetupScriptTestStatus,
} from "./sandbox-profile-setup-script-test.js";
import {
  SandboxProfileSnapshotPanelView,
  SandboxProfileSnapshotRefreshScheduleForm,
  type SnapshotPanelState,
  type SnapshotRefreshSchedule,
} from "./sandbox-profile-snapshot-panel.js";
import { SessionConversationMainContent } from "./session-conversation-pane.js";
import { buildSetupAssistantInitialComposerText } from "./setup-assistant-instructions.js";

export {
  StoryGithubConnection,
  StoryIntegrationConnections,
  StoryIntegrationTargets,
  StorySlackConnection,
};

export const DefaultSandboxProfileEditorStoryArgs = {
  displayName: "Customer Support Sandbox",
  setupScript: `#!/usr/bin/env bash
set -euo pipefail

pnpm install
pnpm dev:bootstrap`,
} satisfies Pick<SandboxProfileEditorPageStoryArgs, "displayName" | "setupScript">;

export type SandboxProfileEditorPageStoryArgs = {
  displayName: string;
  availableConnections?: readonly IntegrationConnectionSummary[];
  availableTargets?: readonly IntegrationTargetSummary[];
  initialSectionId?: StorySectionId;
  lifecycleState?: "draft" | "draft-with-published" | "published" | "published-with-draft";
  publishSuccessMessage?: boolean;
  snapshotState?:
    | "draft-unavailable"
    | "snapshot-unavailable-no-previous"
    | "creating-first-snapshot"
    | "creating-snapshot"
    | "snapshot-ready"
    | "snapshot-failed"
    | "refresh-failed";
  snapshotRefreshScheduleState?: "none" | "existing" | "invalid-preview" | "save-failure";
  integrationsSectionState?: {
    bindingsErrorMessage?: string;
    directoryErrorMessage?: string;
    kind: "error";
  };
  draftSaveErrorMessage?: string;
  draftAutomationImpactError?: string;
  draftAutomationImpactAffectedAutomations?: readonly SandboxProfileVersionDraftAutomationImpactAutomation[];
  initialBindings?: readonly {
    id: string;
    connectionId: string;
    kind: "agent" | "git" | "connector";
    config: Record<string, unknown>;
  }[];
  setupScript: string | null;
  setupScriptDraft?: string;
  setupAssistantPanelState?: "closed" | "starting" | "ready" | "proposed-script";
  setupAssistantErrorMessage?: string;
  setupAssistantState?: "available" | "starting" | "disabled";
  setupScriptTestStatus?: SetupScriptTestStatus;
  runtimeState?: "docker" | "e2b-managed" | "e2b-connection" | "e2b-missing-connection";
};

type IntegrationsSectionState = NonNullable<
  SandboxProfileEditorPageStoryArgs["integrationsSectionState"]
>;
type StorySectionId = "sandbox-profile" | "snapshot";

const StorySections = [
  {
    id: "sandbox-profile",
    label: "Sandbox Profile",
  },
  {
    id: "snapshot",
    label: "Snapshots",
  },
] as const satisfies readonly SandboxProfileEditorSection<StorySectionId>[];

export const StoryBindings = [
  {
    id: "binding-openai-agent",
    connectionId: StoryOpenAiConnection.id,
    kind: "agent" as const,
    config: {
      runtime: {
        runtimeId: "codex",
        config: {},
      },
    },
  },
  {
    id: "binding-github-git",
    connectionId: StoryGithubConnection.id,
    kind: "git" as const,
    config: {
      repositories: ["mistle/main-dashboard", "mistle/control-plane-api", "mistle/sandbox-runtime"],
      tools: ["github-cli"],
    },
  },
  {
    id: "binding-jira-connector",
    connectionId: StoryJiraConnection.id,
    kind: "connector" as const,
    config: {
      tools: ["jira-cli"],
    },
  },
  {
    id: "binding-linear-connector",
    connectionId: StoryLinearConnection.id,
    kind: "connector" as const,
    config: {
      tools: ["linear-mcp"],
    },
  },
  {
    id: "binding-planetscale-connector",
    connectionId: StoryPlanetScaleConnection.id,
    kind: "connector" as const,
    config: {
      tools: ["pscale"],
    },
  },
  {
    id: "binding-aws-connector",
    connectionId: StoryAwsConnection.id,
    kind: "connector" as const,
    config: {
      tools: ["aws-cli"],
    },
  },
] as const;

const StoryE2BSandboxConnection = {
  id: "connection-e2b-sandbox-runtime",
  displayName: "E2B Production",
  targetKey: "e2b-default",
  status: "active",
  config: {},
} satisfies IntegrationConnectionSummary;

const StoryE2BSandboxTarget = {
  targetKey: "e2b-default",
  displayName: "E2B",
  familyId: "e2b",
  variantId: "e2b-default",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
} satisfies IntegrationTargetSummary;

const StorySandboxProviders = [
  {
    id: "docker",
    displayName: "Docker",
    managed: true,
    supportsOrganizationConnection: false,
    resourceCapabilities: null,
  },
  {
    id: "e2b",
    displayName: "E2B",
    managed: true,
    supportsOrganizationConnection: true,
    resourceCapabilities: {
      vcpuCount: {
        min: 1,
        max: 8,
        step: 1,
        default: 2,
      },
      memoryMb: {
        min: 1024,
        max: 8192,
        step: 1024,
        default: 4096,
      },
    },
  },
] satisfies readonly SandboxProviderSummary[];

function createStorySandboxProviders(input: {
  runtimeState: SandboxProfileEditorPageStoryArgs["runtimeState"];
}): readonly SandboxProviderSummary[] {
  if (input.runtimeState === "e2b-missing-connection") {
    return StorySandboxProviders.map((provider) =>
      provider.id === "e2b" ? { ...provider, managed: false } : provider,
    );
  }

  return StorySandboxProviders;
}

type SnapshotStoryStatus = NonNullable<SandboxProfileEditorPageStoryArgs["snapshotState"]>;
type SnapshotRefreshScheduleStoryState = NonNullable<
  SandboxProfileEditorPageStoryArgs["snapshotRefreshScheduleState"]
>;

const SetupAssistantChatEntries: readonly ChatEntry[] = [
  {
    id: "setup-assistant-user-1",
    turnId: "setup-assistant-turn-1",
    kind: "user-message",
    status: "completed",
    text: "Write a setup script for this sandbox profile.",
  },
  {
    id: "setup-assistant-response-1",
    turnId: "setup-assistant-turn-1",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "I can draft the script here. Run the setup test from the editor after applying the draft.",
  },
];

function resolveSnapshotStoryStatus(input: {
  lifecycleState: SandboxProfileEditorPageStoryArgs["lifecycleState"];
  snapshotState: SandboxProfileEditorPageStoryArgs["snapshotState"];
}): SnapshotStoryStatus {
  if (input.snapshotState !== undefined) {
    return input.snapshotState;
  }

  if (
    input.lifecycleState === undefined ||
    input.lifecycleState === "draft" ||
    input.lifecycleState === "draft-with-published"
  ) {
    return "draft-unavailable";
  }

  return "snapshot-ready";
}

function createSnapshotPanelState(status: SnapshotStoryStatus): SnapshotPanelState {
  if (status === "draft-unavailable") {
    return {
      kind: "draft-unavailable",
    };
  }

  if (status === "snapshot-unavailable-no-previous") {
    return {
      kind: "publish-snapshot-error",
      publishedVersion: 1,
      runnableVersion: null,
    };
  }

  if (status === "creating-snapshot") {
    return {
      kind: "creating",
      publishedVersion: 4,
      runnableVersion: 3,
    };
  }

  if (status === "creating-first-snapshot") {
    return {
      kind: "creating",
      publishedVersion: 1,
      runnableVersion: null,
    };
  }

  if (status === "snapshot-failed") {
    return {
      kind: "publish-snapshot-error",
      publishedVersion: 4,
      runnableVersion: 3,
    };
  }

  if (status === "refresh-failed") {
    return {
      kind: "refresh-error",
      latestSnapshotCreatedAt: "Apr 27, 2026, 10:21 AM",
      message: "Snapshot materialization failed.",
    };
  }

  return {
    kind: "ready",
    latestSnapshotCreatedAt: "Apr 27, 2026, 10:21 AM",
  };
}

function createSnapshotRefreshSchedule(
  state: SnapshotRefreshScheduleStoryState,
): SnapshotRefreshSchedule {
  return state === "existing"
    ? {
        cronExpression: "0 9 * * 1",
        enabled: true,
        name: "Weekly refresh",
        nextScheduledAt: "2026-05-04T01:00:00.000Z",
        scheduleId: "snapshot_refresh_schedule_story",
        timezone: "Asia/Singapore",
      }
    : null;
}

function createSnapshotRefreshScheduleInitialDraft(
  state: SnapshotRefreshScheduleStoryState,
): { cronExpression: string; timezone: string } | null {
  if (state === "invalid-preview") {
    return {
      cronExpression: "not a cron expression",
      timezone: "Asia/Singapore",
    };
  }

  if (state === "save-failure") {
    return {
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
    };
  }

  return null;
}

function createRuntimeStoryVersion(input: {
  runtimeState: SandboxProfileEditorPageStoryArgs["runtimeState"];
  version: number;
}): SandboxProfileVersion {
  const runtimeState = input.runtimeState ?? "docker";
  return {
    sandboxProfileId: "sandbox-profile-story",
    version: input.version,
    state: "draft",
    defaultPersistenceMode: "ephemeral",
    sandboxProvider: runtimeState === "docker" ? "docker" : "e2b",
    sandboxConnectionId: runtimeState === "e2b-connection" ? StoryE2BSandboxConnection.id : null,
    sandboxResources:
      runtimeState === "docker"
        ? null
        : {
            vcpuCount: 2,
            memoryMb: 4096,
          },
    isActive: false,
    usable: false,
    refreshSchedule: null,
    latestSnapshotJob: null,
  };
}

function noopStoryAction(): void {}

function SetupScriptStoryControls(input: {
  setupAssistantState: SandboxProfileEditorPageStoryArgs["setupAssistantState"];
  setupAssistantPanelIsOpen: boolean;
  isDraft: boolean;
  onToggleSetupAssistant: () => void;
  testStatus: SetupScriptTestStatus;
}): React.JSX.Element {
  const showSetupAssistantAction = input.setupAssistantState !== undefined;
  const setupAssistantIsStarting =
    !input.setupAssistantPanelIsOpen && input.setupAssistantState === "starting";
  const setupAssistantIsDisabled =
    !input.setupAssistantPanelIsOpen &&
    (input.setupAssistantState === "disabled" || !input.isDraft || setupAssistantIsStarting);
  const setupAssistantTitle = input.setupAssistantPanelIsOpen
    ? "Close the Setup Assistant panel."
    : !input.isDraft
      ? "Setup Assistant is only available while editing a draft."
      : input.setupAssistantState === "disabled"
        ? "Add an agent integration before using Setup Assistant."
        : "Open the right panel to write this setup script.";

  return (
    <SandboxProfileSetupScriptTestButton
      failOnFirstError={true}
      isDraft={input.isDraft}
      status={input.testStatus}
      {...(input.testStatus === "running" ? { onStop: noopStoryAction } : {})}
      {...(showSetupAssistantAction
        ? {
            setupAssistant: {
              disabled: setupAssistantIsDisabled,
              isStarting: setupAssistantIsStarting,
              onClick: input.onToggleSetupAssistant,
              title: setupAssistantTitle,
            },
          }
        : {})}
    />
  );
}

function SetupAssistantPanel(input: {
  onClose: () => void;
  setupScript: string;
  state: Exclude<SandboxProfileEditorPageStoryArgs["setupAssistantPanelState"], undefined>;
}): React.JSX.Element {
  const controlClassName =
    "bg-transparent text-foreground shadow-none hover:bg-stone-100 aria-pressed:bg-stone-200";

  return (
    <aside className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden overscroll-contain">
      <Button
        aria-label="Close Setup Assistant panel"
        className="absolute top-3 left-1 size-8 px-0"
        onClick={input.onClose}
        title="Close right panel"
        type="button"
        variant="ghost"
      >
        <SidebarSimpleIcon aria-hidden className="size-4 -scale-x-100" />
      </Button>
      <div className="flex min-h-14 items-center justify-between gap-3 border-b pr-5 pl-9">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-sm font-semibold tracking-normal">Setup Assistant</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            aria-label={input.state === "starting" ? "Starting" : "Connected"}
            className={[
              "inline-block size-2.5 rounded-full border",
              input.state === "starting"
                ? "border-stone-300 bg-stone-300"
                : "border-emerald-700 bg-emerald-600",
            ].join(" ")}
            role="status"
            title={input.state === "starting" ? "Starting" : "Connected"}
          />
          <span aria-hidden className="h-5 w-px bg-stone-200" />
          <Button
            aria-label="TUI"
            aria-pressed={false}
            className={controlClassName}
            disabled={input.state === "starting"}
            onClick={() => {}}
            size="sm"
            title="Open Setup Assistant TUI"
            type="button"
            variant="ghost"
          >
            TUI
          </Button>
          <Button
            aria-label="Open terminal"
            aria-pressed={false}
            className={controlClassName}
            disabled={input.state === "starting"}
            onClick={() => {}}
            size="icon-sm"
            title="Open terminal"
            type="button"
            variant="ghost"
          >
            <TerminalIcon aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3">
          <SessionConversationMainContent
            activeTurnId={null}
            chatEntries={SetupAssistantChatEntries}
            isRespondingToServerRequest={false}
            isTurnInProgress={input.state === "starting"}
            onRespondToServerRequest={noopRespondToServerRequest}
            pendingTurnId={null}
            scrollBehavior="follow-streaming-at-bottom"
            serverRequestPanelEntries={[]}
          />
        </div>
        <div className="shrink-0 bg-background px-5 py-4">
          <ChatComposer
            {...SessionComposerFixtureProps}
            composerText={buildSetupAssistantInitialComposerText(input.setupScript)}
            gitBranchLabel={null}
            pullRequest={null}
          />
        </div>
      </div>
    </aside>
  );
}

function renderUnavailableIntegrationsSectionPanel(input: {
  state: IntegrationsSectionState;
}): React.JSX.Element {
  return (
    <SandboxProfilePanelSection>
      <SandboxProfileIntegrationsSetupUnavailableState
        integrationBindingsError={
          input.state.bindingsErrorMessage === undefined
            ? null
            : new Error(input.state.bindingsErrorMessage)
        }
        integrationDirectoryError={
          input.state.directoryErrorMessage === undefined
            ? null
            : new Error(input.state.directoryErrorMessage)
        }
      />
    </SandboxProfilePanelSection>
  );
}

function SandboxProfileEditorPageStoryView(
  input: SandboxProfileEditorPageStoryArgs,
): React.JSX.Element {
  const [queryClient] = useState(() => {
    const client = createIntegrationsEditorSectionStoryQueryClient();
    seedStoryIntegrationResources({
      queryClient: client,
      resources: StoryGithubResources,
    });
    return client;
  });
  const [profileName, setProfileName] = useState(input.displayName);
  const [integrationRows, setIntegrationRows] = useState<readonly SandboxProfileBindingEditorRow[]>(
    () => mapBindingsToEditorRows(input.initialBindings ?? StoryBindings),
  );
  const [setupScriptDraft, setSetupScriptDraft] = useState(
    input.setupScriptDraft ?? input.setupScript ?? "",
  );
  const [persistedSetupScript, setPersistedSetupScript] = useState(input.setupScript ?? "");
  const [activeSectionId, setActiveSectionId] = useState<StorySectionId>(
    input.initialSectionId ?? "sandbox-profile",
  );
  const initialSetupAssistantPanelState = input.setupAssistantPanelState ?? "closed";
  const [setupAssistantPanelState, setSetupAssistantPanelState] = useState(
    initialSetupAssistantPanelState,
  );
  const [setupAssistantPanelOpen, setSetupAssistantPanelOpen] = useState(
    initialSetupAssistantPanelState !== "closed",
  );

  async function handleProfileNameSave(nextValue: string): Promise<void> {
    setProfileName(nextValue);
  }

  const isEditable =
    input.lifecycleState === undefined ||
    input.lifecycleState === "draft" ||
    input.lifecycleState === "draft-with-published";
  const mode =
    input.lifecycleState === "published" || input.lifecycleState === "published-with-draft"
      ? {
          kind: "active" as const,
          version: 1,
          activeVersion: 1,
          hasDraft: input.lifecycleState === "published-with-draft",
          draftVersion: input.lifecycleState === "published-with-draft" ? 2 : null,
        }
      : {
          kind: "draft" as const,
          version: input.lifecycleState === "draft-with-published" ? 2 : 1,
          activeVersion: input.lifecycleState === "draft-with-published" ? 1 : null,
          hasDraft: true as const,
        };
  const snapshotStatus = resolveSnapshotStoryStatus({
    lifecycleState: input.lifecycleState,
    snapshotState: input.snapshotState,
  });
  const snapshotPanelState = createSnapshotPanelState(snapshotStatus);
  const snapshotRefreshScheduleState = input.snapshotRefreshScheduleState ?? "none";
  const snapshotRefreshScheduleInitialDraft = createSnapshotRefreshScheduleInitialDraft(
    snapshotRefreshScheduleState,
  );
  const setupScriptTestStatus =
    input.setupScriptTestStatus ?? (setupScriptDraft.trim().length === 0 ? "blank" : "idle");
  const storyConnections = [
    ...(input.availableConnections ?? StoryIntegrationConnections),
    StoryE2BSandboxConnection,
  ];
  const storyTargets = [
    ...(input.availableTargets ?? StoryIntegrationTargets),
    StoryE2BSandboxTarget,
  ];
  function handleToggleSetupAssistant(): void {
    if (setupAssistantPanelOpen) {
      setSetupAssistantPanelOpen(false);
      return;
    }

    setSetupAssistantPanelState(input.setupAssistantState === "starting" ? "starting" : "ready");
    setSetupAssistantPanelOpen(true);
  }

  const editorView = (
    <SandboxProfileEditorView
      activeSectionId={activeSectionId}
      deleteProfileAutomationUsages={[]}
      deleteProfileAutomationUsagesError={null}
      deleteProfileAutomationUsagesIsPending={false}
      deleteProfileError={null}
      deleteProfileIsPending={false}
      draftAutomationImpactError={input.draftAutomationImpactError ?? null}
      draftAutomationImpactAffectedAutomations={
        input.draftAutomationImpactAffectedAutomations ?? null
      }
      onDraftAutomationImpactErrorDismiss={() => {}}
      hasUnpersistedSetupScriptChanges={setupScriptDraft !== persistedSetupScript}
      isDeleteProfileDialogOpen={false}
      mode={mode}
      onConfirmDeleteProfile={() => {}}
      onDeleteProfileDialogOpenChange={() => {}}
      onMakeChanges={() => {}}
      onDiscardChangesAndLeaveDraft={() => {}}
      onPublish={() => {}}
      onSaveDraft={() => {
        setPersistedSetupScript(setupScriptDraft);
      }}
      onSaveProfileName={handleProfileNameSave}
      onActiveSectionIdChange={setActiveSectionId}
      onViewActive={() => {}}
      onViewDraft={() => {}}
      profileName={profileName}
      profileNameFallback={profileName}
      draftSaveError={input.draftSaveErrorMessage ?? null}
      versionActionError={null}
      versionActionIsPending={false}
      renderSectionPanel={(sectionId) => {
        if (sectionId === "sandbox-profile") {
          if (input.integrationsSectionState !== undefined) {
            return renderUnavailableIntegrationsSectionPanel({
              state: input.integrationsSectionState,
            });
          }

          return (
            <div className="flex w-full flex-col gap-8">
              <SandboxProfilePanelSection>
                <SandboxProfileRuntimeSection
                  availableConnections={storyConnections}
                  availableTargets={storyTargets}
                  disabled={!isEditable}
                  isDraft={mode.kind === "draft"}
                  providers={createStorySandboxProviders({
                    runtimeState: input.runtimeState,
                  })}
                  version={createRuntimeStoryVersion({
                    runtimeState: input.runtimeState,
                    version: mode.version,
                  })}
                />
              </SandboxProfilePanelSection>
              <SandboxProfilePanelSection>
                <SandboxProfileIntegrationsSetupSection
                  availableConnections={storyConnections}
                  availableTargets={storyTargets}
                  integrationBindingsQuery={{
                    isError: false,
                    error: null,
                    isPending: false,
                  }}
                  integrationDirectoryQuery={{
                    isError: false,
                    error: null,
                    isPending: false,
                  }}
                  integrationRows={integrationRows}
                  integrationSaveError={null}
                  disabled={!isEditable}
                  onAddIntegrationBindingRow={async (nextBinding) => {
                    setIntegrationRows((currentRows) => [
                      ...currentRows,
                      {
                        clientId: `row-${String(currentRows.length + 1)}`,
                        connectionId: nextBinding.connectionId,
                        kind: nextBinding.kind,
                        config: nextBinding.config,
                      },
                    ]);
                    return true;
                  }}
                  onIntegrationBindingRowChange={(clientId, changes) => {
                    setIntegrationRows((currentRows) =>
                      currentRows.map((row) =>
                        row.clientId === clientId ? { ...row, ...changes } : row,
                      ),
                    );
                  }}
                  onRemoveIntegrationBindingRow={(clientId) => {
                    setIntegrationRows((currentRows) =>
                      currentRows.filter((row) => row.clientId !== clientId),
                    );
                  }}
                  onIntegrationSaveErrorDismiss={() => {}}
                />
              </SandboxProfilePanelSection>
              <SandboxProfilePanelSection>
                <div className="flex flex-col gap-4">
                  {input.setupAssistantErrorMessage === undefined ? null : (
                    <Notice variant="alert">{input.setupAssistantErrorMessage}</Notice>
                  )}
                  <SandboxProfileSetupScriptPanel
                    onChange={setSetupScriptDraft}
                    disabled={!isEditable}
                    repositoryHandles={resolveSandboxBaseRepositoryHandles(integrationRows)}
                    testControl={
                      <SetupScriptStoryControls
                        setupAssistantState={input.setupAssistantState}
                        setupAssistantPanelIsOpen={setupAssistantPanelOpen}
                        isDraft={mode.kind === "draft"}
                        onToggleSetupAssistant={handleToggleSetupAssistant}
                        testStatus={setupScriptTestStatus}
                      />
                    }
                    testPanel={
                      <SandboxProfileSetupScriptTestPanel
                        isDraft={mode.kind === "draft"}
                        status={setupScriptTestStatus}
                      />
                    }
                    value={setupScriptDraft}
                  />
                </div>
              </SandboxProfilePanelSection>
            </div>
          );
        }

        if (sectionId === "snapshot") {
          return (
            <SandboxProfileSnapshotPanelView
              isActionPending={false}
              onPublishSuccessMessageDismiss={() => {}}
              onRefreshSnapshot={() => {}}
              onRetryPublishSnapshot={() => {}}
              publishSuccessMessage={input.publishSuccessMessage === true}
              publishSuccessMessageKey={input.publishSuccessMessage === true ? "visible" : "idle"}
              refreshScheduleSection={
                snapshotStatus === "draft-unavailable" ? null : (
                  <SandboxProfileSnapshotRefreshScheduleForm
                    disabled={false}
                    existingSchedule={createSnapshotRefreshSchedule(snapshotRefreshScheduleState)}
                    {...(snapshotRefreshScheduleInitialDraft === null
                      ? {}
                      : { initialDraft: snapshotRefreshScheduleInitialDraft })}
                    mutationError={
                      snapshotRefreshScheduleState === "save-failure"
                        ? "Could not save snapshot refresh schedule."
                        : null
                    }
                    onDeleteSchedule={() => {}}
                    onSaveSchedule={() => {}}
                    previewAfter={new Date("2026-04-29T00:00:00.000Z")}
                  />
                )
              }
              state={snapshotPanelState}
              version={resolveSnapshotStoryVersion({
                snapshotPanelState,
                snapshotStatus,
              })}
            />
          );
        }

        throw new Error("Unhandled story section.");
      }}
      sections={StorySections}
    />
  );

  return (
    <QueryClientProvider client={queryClient}>
      {!setupAssistantPanelOpen ? (
        editorView
      ) : (
        <div className="fixed inset-0 overflow-hidden">
          <ResizablePanelGroup
            className="h-screen min-h-0 overflow-hidden"
            id="setup-assistant-page-panel-group"
            orientation="horizontal"
          >
            <ResizablePanel defaultSize="72%" id="setup-assistant-page-main" minSize="45%">
              <div className="h-full min-h-0 overflow-y-auto overscroll-contain">{editorView}</div>
            </ResizablePanel>
            <ResizableHandle id="setup-assistant-page-resize-handle" />
            <ResizablePanel defaultSize="28%" id="setup-assistant-page-panel" minSize="360px">
              <SetupAssistantPanel
                onClose={() => {
                  setSetupAssistantPanelOpen(false);
                }}
                setupScript={setupScriptDraft}
                state={setupAssistantPanelState}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}
    </QueryClientProvider>
  );
}

function resolveSnapshotStoryVersion(input: {
  snapshotPanelState: SnapshotPanelState;
  snapshotStatus: SnapshotStoryStatus;
}): number | null {
  if (input.snapshotStatus === "draft-unavailable") {
    return null;
  }

  if (
    input.snapshotPanelState.kind === "creating" ||
    input.snapshotPanelState.kind === "publish-snapshot-error"
  ) {
    return input.snapshotPanelState.publishedVersion;
  }

  return 1;
}

export function SandboxProfileEditorPageStory(
  input: SandboxProfileEditorPageStoryArgs,
): React.JSX.Element {
  const router = useMemo(
    () =>
      createMemoryRouter(
        createRoutesFromElements(
          <Route element={<SandboxProfileEditorPageStoryView {...input} />} path="/" />,
        ),
        {
          initialEntries: ["/"],
        },
      ),
    [input],
  );

  return <RouterProvider router={router} />;
}
