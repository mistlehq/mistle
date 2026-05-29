import { Button, Notice, ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@mistle/ui";
import { SidebarSimpleIcon, TerminalIcon } from "@phosphor-icons/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";

import type { ChatEntry } from "../chat/chat-types.js";
import { ChatComposer } from "../chat/components/chat-composer.js";
import { noopRespondToServerRequest } from "../chat/components/chat-story-support.js";
import type { SandboxProfileVersionDraftTriggerImpactTrigger } from "../sandbox-profiles/sandbox-profiles-types.js";
import type {
  SandboxProviderSummary,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { SessionComposerFixtureProps } from "../session-agents/codex/fixtures/session-fixtures.js";
import { sandboxOperationEventsQueryKey } from "../sessions/sessions-query-keys.js";
import type { SandboxOperationEvent } from "../sessions/sessions-types.js";
import type { ApiKey, CreatedApiKey } from "../settings/api-keys/api-keys-service.js";
import {
  createIntegrationsEditorSectionStoryQueryClient,
  seedStoryIntegrationResources,
  StoryAnthropicConnection,
  StoryAwsConnection,
  StoryGithubConnection,
  StoryGithubResources,
  StoryIntegrationConnections,
  StoryIntegrationTargets,
  StoryJiraConnection,
  StoryLinearConnection,
  StoryOpenCodeGoConnection,
  StoryOpenAiConnection,
  StoryPlanetScaleConnection,
  StorySlackConnection,
} from "./integrations-editor-section-story-support.js";
import { resolveSandboxBaseRepositoryHandles } from "./sandbox-base-inventory-copy.js";
import { SandboxOperationProgressView } from "./sandbox-operation-progress.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  SandboxProfileEditorView,
  SandboxProfilePanelSection,
  SandboxProfileSetupScriptPanel,
  SetupAssistantCloseDialog,
  SetupAssistantStartDialog,
} from "./sandbox-profile-editor-page.js";
import type { SandboxProfileEditorSection } from "./sandbox-profile-editor-sections.js";
import {
  SandboxProfileIntegrationsSetupSection,
  SandboxProfileIntegrationsSetupUnavailableState,
} from "./sandbox-profile-integrations-setup-section.js";
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
import { SessionStartupStatus } from "./session-startup-status.js";
import { buildSetupAssistantInitialComposerText } from "./setup-assistant-instructions.js";

export {
  StoryAnthropicConnection,
  StoryGithubConnection,
  StoryIntegrationConnections,
  StoryIntegrationTargets,
  StoryOpenCodeGoConnection,
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
  agentRuntimeId?: SandboxProfileVersion["agentRuntimeId"];
  publishSuccessMessage?: boolean;
  snapshotState?:
    | "draft-unavailable"
    | "snapshot-unavailable-no-previous"
    | "creating-first-snapshot"
    | "creating-snapshot-with-events"
    | "creating-snapshot"
    | "snapshot-ready"
    | "snapshot-failed"
    | "refresh-failed";
  snapshotRefreshScheduleState?: "none" | "existing" | "invalid-preview" | "save-failure";
  snapshotMaintenanceScript?: string | null;
  integrationsSectionState?: {
    bindingsErrorMessage?: string;
    directoryErrorMessage?: string;
    kind: "error";
  };
  draftSaveErrorMessage?: string;
  draftTriggerImpactError?: string;
  draftTriggerImpactAffectedTriggers?: readonly SandboxProfileVersionDraftTriggerImpactTrigger[];
  duplicateProfileAvailability?: "available" | "unavailable";
  duplicateProfileDialogState?: "closed" | "open" | "error";
  duplicateProfileTriggerState?: "none" | "with-triggers" | "loading" | "error";
  initialBindings?: readonly {
    id: string;
    connectionId: string;
    kind: "agent" | "git" | "connector";
    config: Record<string, unknown>;
  }[];
  identityLinkedGitConnectionIds?: readonly string[];
  initialGitCommitSigningIntegrationConnectionId?: string | null;
  setupScript: string | null;
  setupScriptDraft?: string;
  setupAssistantStartDialogState?: "choice" | "save-required" | "use-saved-required";
  setupAssistantPanelState?: "closed" | "starting" | "disconnected" | "ready" | "proposed-script";
  setupAssistantErrorMessage?: string;
  setupAssistantState?: "available" | "starting" | "disabled";
  setupScriptTestStatus?: SetupScriptTestStatus;
  runtimeState?: "docker" | "e2b-managed" | "e2b-connection" | "e2b-missing-connection";
  apiKeys?: readonly ApiKey[];
  mistleMcpEnabled?: boolean;
  mistleMcpApiKeyId?: string | null;
};

type IntegrationsSectionState = NonNullable<
  SandboxProfileEditorPageStoryArgs["integrationsSectionState"]
>;
type StorySectionId = "sandbox-profile" | "triggers" | "snapshot";

const StorySections = [
  {
    id: "sandbox-profile",
    label: "Sandbox Profile",
  },
  {
    id: "snapshot",
    label: "Snapshots",
  },
  {
    id: "triggers",
    label: "Triggers",
  },
] as const satisfies readonly SandboxProfileEditorSection<StorySectionId>[];

const StorySetupAssistantOperationId = "owfr_story_setup_assistant";
const StorySetupAssistantSandboxInstanceId = "sbi_story_setup_assistant";
const StorySnapshotOperationId = "ssj_story_creating_snapshot";
const StorySnapshotSandboxInstanceId = "sbi_story_creating_snapshot";

export const StoryMistleApiKey = {
  id: "apk_story_mistle_agent",
  name: "Sandbox agent key",
  secretPrefix: "mstl_apk_story",
  permissions: ["sandboxProfile:read", "sandboxProfile:update", "sandboxSession:read"],
  expiresAt: null,
  lastUsedAt: "2026-05-13T10:00:00.000Z",
  createdAt: "2026-05-01T10:00:00.000Z",
  updatedAt: "2026-05-01T10:00:00.000Z",
} satisfies ApiKey;

export const StoryMistleApiKeys = [StoryMistleApiKey] satisfies readonly ApiKey[];

export const StoryBindings = [
  {
    id: "binding-openai-agent",
    connectionId: StoryOpenAiConnection.id,
    kind: "agent" as const,
    config: {},
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
        max: 16_384,
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
      operationId: null,
      publishedVersion: 1,
      runnableVersion: null,
      sandboxInstanceId: null,
    };
  }

  if (status === "creating-snapshot" || status === "creating-snapshot-with-events") {
    return {
      kind: "creating",
      operationId: StorySnapshotOperationId,
      publishedVersion: 4,
      runnableVersion: 3,
      sandboxInstanceId: StorySnapshotSandboxInstanceId,
    };
  }

  if (status === "creating-first-snapshot") {
    return {
      kind: "creating",
      operationId: "ssj_story_creating_first_snapshot",
      publishedVersion: 1,
      runnableVersion: null,
      sandboxInstanceId: "sbi_story_creating_first_snapshot",
    };
  }

  if (status === "snapshot-failed") {
    return {
      kind: "publish-snapshot-error",
      operationId: "ssj_story_failed_snapshot",
      publishedVersion: 4,
      runnableVersion: 3,
      sandboxInstanceId: "sbi_story_failed_snapshot",
    };
  }

  if (status === "refresh-failed") {
    return {
      kind: "refresh-error",
      latestSnapshotCreatedAt: "Apr 27, 2026, 10:21 AM",
      message: "Snapshot materialization failed.",
      operationId: "ssj_story_failed_refresh",
      sandboxInstanceId: "sbi_story_failed_refresh",
    };
  }

  return {
    kind: "ready",
    latestSnapshotCreatedAt: "Apr 27, 2026, 10:21 AM",
    operationId: null,
    sandboxInstanceId: null,
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
  agentRuntimeId: SandboxProfileVersion["agentRuntimeId"];
  gitCommitSigningIntegrationConnectionId: string | null;
  mistleMcpApiKeyId: string | null;
  mistleMcpEnabled: boolean;
  runtimeState: SandboxProfileEditorPageStoryArgs["runtimeState"];
  version: number;
}): SandboxProfileVersion {
  const runtimeState = input.runtimeState ?? "docker";
  return {
    sandboxProfileId: "sandbox-profile-story",
    version: input.version,
    state: "draft",
    publishedAt: null,
    agentRuntimeId: input.agentRuntimeId,
    gitCommitSigningIntegrationConnectionId: input.gitCommitSigningIntegrationConnectionId,
    mistleMcpEnabled: input.mistleMcpEnabled,
    mistleMcpApiKeyId: input.mistleMcpApiKeyId,
    defaultPersistenceMode: "ephemeral",
    sandboxProvider: runtimeState === "docker" ? "docker" : "e2b",
    sandboxConnectionId: runtimeState === "e2b-connection" ? StoryE2BSandboxConnection.id : null,
    maintenanceScript: null,
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
      canRun={input.isDraft}
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
    "bg-transparent text-foreground shadow-none hover:bg-muted/60 aria-pressed:bg-muted";
  const isConnected = input.state !== "starting" && input.state !== "disconnected";
  const statusLabel =
    input.state === "starting"
      ? "Starting"
      : input.state === "disconnected"
        ? "Disconnected"
        : "Connected";
  const controlsAreDisabled = !isConnected;

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
            aria-label={statusLabel}
            className={[
              "inline-block size-2.5 rounded-full border",
              isConnected
                ? "border-emerald-700 bg-emerald-600"
                : "border-muted-foreground/30 bg-muted-foreground/30",
            ].join(" ")}
            role="status"
            title={statusLabel}
          />
          <span aria-hidden className="h-5 w-px bg-border" />
          <Button
            aria-label="TUI"
            aria-pressed={false}
            className={controlClassName}
            disabled={controlsAreDisabled}
            onClick={() => {}}
            size="sm"
            title={
              controlsAreDisabled
                ? "Setup Assistant TUI is unavailable."
                : "Open Setup Assistant TUI"
            }
            type="button"
            variant="ghost"
          >
            TUI
          </Button>
          <Button
            aria-label="Open terminal"
            aria-pressed={false}
            className={controlClassName}
            disabled={controlsAreDisabled}
            onClick={() => {}}
            size="icon-sm"
            title={controlsAreDisabled ? "Terminal is unavailable." : "Open terminal"}
            type="button"
            variant="ghost"
          >
            <TerminalIcon aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {input.state === "starting" ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6">
            <div className="mx-auto flex h-full w-full max-w-5xl flex-col justify-center gap-4">
              <SessionStartupStatus state="preparing_sandbox" />
              <SandboxOperationProgressView
                displayMode="timeline"
                emptyMessage="Waiting for Setup Assistant startup events."
                errorMessage={null}
                events={SetupAssistantStartupOperationEvents}
                isLoading
                showBorder
                showLoadError={false}
              />
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3">
            <SessionConversationMainContent
              activeTurnId={null}
              chatEntries={SetupAssistantChatEntries}
              isRespondingToServerRequest={false}
              isTurnInProgress={false}
              onRespondToServerRequest={noopRespondToServerRequest}
              pendingTurnId={null}
              scrollBehavior="follow-streaming-at-bottom"
              serverRequestPanelEntries={[]}
            />
          </div>
        )}
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

const SetupAssistantStartupOperationEvents = [
  sandboxOperationLifecycleEvent({
    id: "soe_setup_assistant_provider_started",
    message: "Starting setup assistant sandbox.",
    operationId: StorySetupAssistantOperationId,
    operationKind: "start",
    phase: "provider",
    sandboxInstanceId: StorySetupAssistantSandboxInstanceId,
    sequence: 1,
    source: "worker",
    status: "started",
  }),
  sandboxOperationLifecycleEvent({
    id: "soe_setup_assistant_sandboxd_started",
    message: "Starting sandbox daemon.",
    operationId: StorySetupAssistantOperationId,
    operationKind: "start",
    phase: "sandboxd",
    sandboxInstanceId: StorySetupAssistantSandboxInstanceId,
    sequence: 2,
    source: "worker",
    status: "started",
  }),
] satisfies readonly SandboxOperationEvent[];

const SnapshotCreationOperationEvents = [
  sandboxOperationLifecycleEvent({
    id: "soe_story_snapshot_provider_started",
    message: "Starting snapshot sandbox.",
    operationId: StorySnapshotOperationId,
    operationKind: "snapshot",
    phase: "provider",
    sandboxInstanceId: StorySnapshotSandboxInstanceId,
    sequence: 1,
    source: "worker",
    status: "started",
  }),
  sandboxOperationLifecycleEvent({
    id: "soe_story_snapshot_provider_completed",
    message: "Snapshot sandbox started.",
    operationId: StorySnapshotOperationId,
    operationKind: "snapshot",
    phase: "provider",
    sandboxInstanceId: StorySnapshotSandboxInstanceId,
    sequence: 2,
    source: "worker",
    status: "completed",
  }),
  sandboxOperationLifecycleEvent({
    id: "soe_story_snapshot_sandboxd_started",
    message: "Starting sandbox daemon.",
    operationId: StorySnapshotOperationId,
    operationKind: "snapshot",
    phase: "sandboxd",
    sandboxInstanceId: StorySnapshotSandboxInstanceId,
    sequence: 3,
    source: "worker",
    status: "started",
  }),
  sandboxOperationLifecycleEvent({
    id: "soe_story_snapshot_runtime_plan_started",
    message: "Applying runtime plan.",
    operationId: StorySnapshotOperationId,
    operationKind: "snapshot",
    phase: "runtime_plan",
    sandboxInstanceId: StorySnapshotSandboxInstanceId,
    sequence: 4,
    source: "sandboxd",
    status: "started",
  }),
] satisfies readonly SandboxOperationEvent[];

function sandboxOperationLifecycleEvent(input: {
  id: string;
  message: string;
  operationId: string;
  operationKind: SandboxOperationEvent["operationKind"];
  phase: NonNullable<SandboxOperationEvent["phase"]>;
  sandboxInstanceId: string;
  sequence: number;
  source: SandboxOperationEvent["source"];
  status: NonNullable<SandboxOperationEvent["status"]>;
}): SandboxOperationEvent {
  return {
    attributes: {},
    createdAt: "2026-05-13T10:00:00.000Z",
    id: input.id,
    message: input.message,
    observedAt: "2026-05-13T10:00:00.000Z",
    operationId: input.operationId,
    operationKind: input.operationKind,
    payloadBase64: null,
    phase: input.phase,
    recordKind: "lifecycle",
    sandboxInstanceId: input.sandboxInstanceId,
    sequence: input.sequence,
    source: input.source,
    status: input.status,
    stream: null,
  };
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
    if (input.snapshotState === "creating-snapshot-with-events") {
      client.setQueryData(
        sandboxOperationEventsQueryKey({
          afterSequence: null,
          operationId: StorySnapshotOperationId,
          sandboxInstanceId: StorySnapshotSandboxInstanceId,
        }),
        {
          events: SnapshotCreationOperationEvents,
        },
      );
    }
    return client;
  });
  const [profileName, setProfileName] = useState(input.displayName);
  const [integrationRows, setIntegrationRows] = useState<readonly SandboxProfileBindingEditorRow[]>(
    () => mapBindingsToEditorRows(input.initialBindings ?? StoryBindings),
  );
  const [apiKeys, setApiKeys] = useState<readonly ApiKey[]>(input.apiKeys ?? StoryMistleApiKeys);
  const [gitCommitSigningIntegrationConnectionId, setGitCommitSigningIntegrationConnectionId] =
    useState<string | null>(input.initialGitCommitSigningIntegrationConnectionId ?? null);
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
  const [setupAssistantStartDialogOpen, setSetupAssistantStartDialogOpen] = useState(
    input.setupAssistantStartDialogState !== undefined,
  );
  const [setupAssistantCloseDialogOpen, setSetupAssistantCloseDialogOpen] = useState(false);
  const [setupAssistantPanelScript, setSetupAssistantPanelScript] = useState(setupScriptDraft);
  const [duplicateProfileDialogOpen, setDuplicateProfileDialogOpen] = useState(
    input.duplicateProfileDialogState === "open" || input.duplicateProfileDialogState === "error",
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
  const snapshotMaintenanceScript = input.snapshotMaintenanceScript ?? null;
  const hasSnapshotMaintenanceScript = (snapshotMaintenanceScript?.trim().length ?? 0) > 0;
  const canRunSnapshotMaintenance =
    snapshotPanelState.kind === "ready" && hasSnapshotMaintenanceScript;
  const duplicateProfileIsAvailable =
    input.duplicateProfileAvailability === undefined
      ? mode.activeVersion !== null && snapshotStatus === "snapshot-ready"
      : input.duplicateProfileAvailability === "available";
  const duplicateProfileTriggerState = input.duplicateProfileTriggerState ?? "none";
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
  const agentRuntimeId = input.agentRuntimeId ?? "codex";
  function handleToggleSetupAssistant(): void {
    if (setupAssistantPanelOpen) {
      setSetupAssistantCloseDialogOpen(true);
      return;
    }

    if (input.setupAssistantStartDialogState !== undefined) {
      setSetupAssistantStartDialogOpen(true);
      return;
    }

    setSetupAssistantPanelScript(setupScriptDraft);
    setSetupAssistantPanelState(input.setupAssistantState === "starting" ? "starting" : "ready");
    setSetupAssistantPanelOpen(true);
  }

  function handleSaveAndOpenSetupAssistant(): void {
    setPersistedSetupScript(setupScriptDraft);
    setSetupAssistantPanelScript(setupScriptDraft);
    setSetupAssistantStartDialogOpen(false);
    setSetupAssistantPanelState("ready");
    setSetupAssistantPanelOpen(true);
  }

  function handleUseLatestSavedDraftSetupAssistant(): void {
    setSetupAssistantPanelScript(persistedSetupScript);
    setSetupAssistantStartDialogOpen(false);
    setSetupAssistantPanelState("ready");
    setSetupAssistantPanelOpen(true);
  }

  function handleConfirmSetupAssistantClose(): void {
    setSetupAssistantCloseDialogOpen(false);
    setSetupAssistantPanelOpen(false);
  }

  async function handleCreateApiKey(createInput: {
    name: string;
    permissions: readonly string[];
  }): Promise<CreatedApiKey> {
    const now = "2026-05-20T10:00:00.000Z";
    const createdApiKey = {
      id: `apk_story_${String(apiKeys.length + 1)}`,
      name: createInput.name,
      secretPrefix: "mstl_apk_new_story",
      permissions: [...createInput.permissions],
      expiresAt: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    } satisfies ApiKey;

    setApiKeys((currentApiKeys) => [createdApiKey, ...currentApiKeys]);

    return {
      apiKey: createdApiKey,
      token: "mstl_apk_story_created_token",
    };
  }

  const copyableDuplicateProfileTriggerUsages =
    duplicateProfileTriggerState === "with-triggers"
      ? [
          {
            id: "trg_story_pr_checks",
            kind: "webhook" as const,
            name: "PR checks",
            sandboxProfileVersion: mode.activeVersion ?? 1,
          },
          {
            id: "trg_story_nightly",
            kind: "schedule" as const,
            name: "Nightly maintenance",
            sandboxProfileVersion: mode.activeVersion ?? 1,
          },
        ]
      : [];

  const editorView = (
    <SandboxProfileEditorView
      activeSectionId={activeSectionId}
      deleteProfileTriggerUsages={[]}
      deleteProfileTriggerUsagesError={null}
      deleteProfileTriggerUsagesIsPending={false}
      deleteProfileError={null}
      deleteProfileIsPending={false}
      duplicateProfileError={
        input.duplicateProfileDialogState === "error"
          ? "Could not duplicate this sandbox profile. Please try again."
          : null
      }
      duplicateProfileIsAvailable={duplicateProfileIsAvailable}
      duplicateProfileIsPending={false}
      duplicateProfileTriggerUsages={copyableDuplicateProfileTriggerUsages}
      duplicateProfileTriggerUsagesError={
        duplicateProfileTriggerState === "error" ? "Could not load triggers." : null
      }
      duplicateProfileTriggerUsagesIsPending={duplicateProfileTriggerState === "loading"}
      draftTriggerImpactError={input.draftTriggerImpactError ?? null}
      draftTriggerImpactAffectedTriggers={input.draftTriggerImpactAffectedTriggers ?? null}
      onDraftTriggerImpactErrorDismiss={() => {}}
      hasUnpersistedSetupScriptChanges={setupScriptDraft !== persistedSetupScript}
      isDeleteProfileDialogOpen={false}
      isDuplicateProfileDialogOpen={duplicateProfileDialogOpen}
      mode={mode}
      onConfirmDeleteProfile={() => {}}
      onConfirmDuplicateProfile={() => {}}
      onDeleteProfileDialogOpenChange={() => {}}
      onDuplicateProfileDialogOpenChange={setDuplicateProfileDialogOpen}
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
          return (
            <div className="flex w-full flex-col gap-8">
              {input.integrationsSectionState === undefined ? (
                <SandboxProfilePanelSection>
                  <SandboxProfileIntegrationsSetupSection
                    agentRuntimeId={agentRuntimeId}
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
                    gitCommitSigningIntegrationConnectionId={
                      gitCommitSigningIntegrationConnectionId
                    }
                    identityLinkedGitConnectionIds={
                      input.identityLinkedGitConnectionIds ?? [StoryGithubConnection.id]
                    }
                    runtimeSettings={
                      <SandboxProfileRuntimeSection
                        apiKeys={apiKeys}
                        availableConnections={storyConnections}
                        availableTargets={storyTargets}
                        disabled={!isEditable}
                        isDraft={mode.kind === "draft"}
                        onCreateApiKey={handleCreateApiKey}
                        providers={createStorySandboxProviders({
                          runtimeState: input.runtimeState,
                        })}
                        sectionChrome={false}
                        version={createRuntimeStoryVersion({
                          agentRuntimeId,
                          gitCommitSigningIntegrationConnectionId,
                          mistleMcpApiKeyId:
                            input.mistleMcpApiKeyId === undefined ? null : input.mistleMcpApiKeyId,
                          mistleMcpEnabled: input.mistleMcpEnabled === true,
                          runtimeState: input.runtimeState,
                          version: mode.version,
                        })}
                      />
                    }
                    disabled={!isEditable}
                    readOnly={!isEditable}
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
                    onGitCommitSigningIntegrationConnectionChange={
                      setGitCommitSigningIntegrationConnectionId
                    }
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
              ) : (
                renderUnavailableIntegrationsSectionPanel({
                  state: input.integrationsSectionState,
                })
              )}
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
                      <SandboxProfileSetupScriptTestPanel status={setupScriptTestStatus} />
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
              canRunMaintenanceRefresh={canRunSnapshotMaintenance}
              isActionPending={false}
              onMaintenanceRefreshSnapshot={() => {}}
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
                    maintenanceScriptDraft={snapshotMaintenanceScript ?? ""}
                    maintenanceScriptHasChanges={false}
                    mutationError={
                      snapshotRefreshScheduleState === "save-failure"
                        ? "Could not save snapshot refresh schedule."
                        : null
                    }
                    onApplyPendingExternalMaintenanceScript={() => {}}
                    onChangeMaintenanceScript={() => {}}
                    onDeleteSchedule={() => {}}
                    onDismissPendingExternalMaintenanceScript={() => {}}
                    onSaveSchedule={() => {}}
                    pendingExternalMaintenanceScript={false}
                    previewAfter={new Date("2026-04-29T00:00:00.000Z")}
                    savedMaintenanceScript={snapshotMaintenanceScript ?? ""}
                    setupAssistantControl={{
                      disabled: false,
                      isStarting: false,
                      onToggle: () => {},
                      title: "Open the right panel to write this snapshot maintenance script.",
                    }}
                    testButtonProps={{
                      canRun: canRunSnapshotMaintenance,
                      disabled: !canRunSnapshotMaintenance,
                      status: hasSnapshotMaintenanceScript ? "idle" : "blank",
                    }}
                    testPanel={null}
                  />
                )
              }
              showMaintenanceRefreshAction={
                createSnapshotRefreshSchedule(snapshotRefreshScheduleState) !== null &&
                hasSnapshotMaintenanceScript
              }
              state={snapshotPanelState}
              version={resolveSnapshotStoryVersion({
                snapshotPanelState,
                snapshotStatus,
              })}
            />
          );
        }

        if (sectionId === "triggers") {
          return (
            <div className="flex min-h-64 items-center justify-center rounded-md border bg-background p-6 text-center text-sm text-muted-foreground">
              No triggers use this sandbox profile.
            </div>
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
        <>
          {editorView}
          <SetupAssistantStartDialog
            isOpen={setupAssistantStartDialogOpen}
            isPending={false}
            onOpenChange={setSetupAssistantStartDialogOpen}
            onSaveAndOpen={handleSaveAndOpenSetupAssistant}
            onUseLatestSavedDraft={handleUseLatestSavedDraftSetupAssistant}
            variant={input.setupAssistantStartDialogState ?? "choice"}
          />
        </>
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
                  setSetupAssistantCloseDialogOpen(true);
                }}
                setupScript={setupAssistantPanelScript}
                state={setupAssistantPanelState}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
          <SetupAssistantCloseDialog
            isOpen={setupAssistantCloseDialogOpen}
            onCancel={() => {
              setSetupAssistantCloseDialogOpen(false);
            }}
            onConfirm={handleConfirmSetupAssistantClose}
          />
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
