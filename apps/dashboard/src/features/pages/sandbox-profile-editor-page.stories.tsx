import { systemScheduler, type TimerHandle } from "@mistle/time";
import { WarningCircleIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  clearPendingStatusTimeouts,
  scheduleSavedStateReset,
} from "../shared/auto-save-behavior.js";
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
import {
  SandboxProfileSetupScriptTestButton,
  SandboxProfileSetupScriptTestPanel,
  type SetupScriptTestStatus,
} from "./sandbox-profile-setup-script-test.js";
import {
  SandboxProfileSnapshotPanelView,
  SandboxProfileSnapshotRefreshScheduleForm,
  shouldShowMissingSnapshotAlert,
  type SnapshotPanelState,
  type SnapshotRefreshSchedule,
} from "./sandbox-profile-snapshot-panel.js";

type SandboxProfileEditorPageStoryArgs = {
  displayName: string;
  availableConnections?: readonly IntegrationConnectionSummary[];
  availableTargets?: readonly IntegrationTargetSummary[];
  initialSectionId?: StorySectionId;
  lifecycleState?: "draft" | "draft-with-published" | "published" | "published-with-draft";
  publishSuccessMessage?: boolean;
  snapshotState?:
    | "draft-unavailable"
    | "no-snapshot"
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
  integrationSaveErrorMessage?: string;
  initialBindings?: readonly {
    id: string;
    connectionId: string;
    kind: "agent" | "git" | "connector";
    config: Record<string, unknown>;
  }[];
  setupScript: string | null;
  setupScriptTestStatus?: SetupScriptTestStatus;
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

function createStorySections(input: {
  showMissingSnapshotAlert: boolean;
}): readonly SandboxProfileEditorSection<StorySectionId>[] {
  return StorySections.map((section) =>
    section.id === "snapshot"
      ? {
          ...section,
          sideLabel: (
            <span className="inline-flex items-center gap-1.5">
              <span>Snapshots</span>
              {input.showMissingSnapshotAlert ? (
                <WarningCircleIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-destructive"
                />
              ) : null}
            </span>
          ),
        }
      : section,
  );
}

const StoryBindings = [
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

type SnapshotStoryStatus = NonNullable<SandboxProfileEditorPageStoryArgs["snapshotState"]>;
type SnapshotRefreshScheduleStoryState = NonNullable<
  SandboxProfileEditorPageStoryArgs["snapshotRefreshScheduleState"]
>;

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

  if (status === "no-snapshot") {
    return {
      kind: "no-snapshot",
    };
  }

  if (status === "creating-snapshot") {
    return {
      kind: "creating",
    };
  }

  if (status === "snapshot-failed") {
    return {
      kind: "snapshot-error",
      message: "Snapshot materialization failed.",
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
      cronExpression: "*/15 9 * * *",
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
        isPending={false}
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
  const [integrationSaveErrorMessage, setIntegrationSaveErrorMessage] = useState(
    input.integrationSaveErrorMessage ?? null,
  );
  const [setupScriptDraft, setSetupScriptDraft] = useState(input.setupScript ?? "");
  const [persistedSetupScript, setPersistedSetupScript] = useState(input.setupScript ?? "");
  const [setupScriptSaveStatus, setSetupScriptSaveStatus] = useState<
    "idle" | "saving" | "saved" | "saved-fading"
  >("idle");
  const [activeSectionId, setActiveSectionId] = useState<StorySectionId>(
    input.initialSectionId ?? "sandbox-profile",
  );
  const fadeStartTimeoutRef = useRef<TimerHandle | null>(null);
  const fadeEndTimeoutRef = useRef<TimerHandle | null>(null);

  useEffect(() => {
    setIntegrationSaveErrorMessage(input.integrationSaveErrorMessage ?? null);
  }, [input.integrationSaveErrorMessage]);

  useEffect(() => {
    return () => {
      clearPendingStatusTimeouts({
        fadeEndTimeoutRef,
        fadeStartTimeoutRef,
        scheduler: systemScheduler,
      });
    };
  }, []);

  async function handleProfileNameSave(nextValue: string): Promise<void> {
    setProfileName(nextValue);
  }

  function handleSetupScriptBlur(): void {
    if (setupScriptDraft === persistedSetupScript) {
      setSetupScriptSaveStatus("idle");
      return;
    }

    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler: systemScheduler,
    });
    setPersistedSetupScript(setupScriptDraft);
    setSetupScriptSaveStatus("saved");
    scheduleSavedStateReset({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      onFadeEnd: () => {
        setSetupScriptSaveStatus("idle");
      },
      onFadeStart: () => {
        setSetupScriptSaveStatus("saved-fading");
      },
      scheduler: systemScheduler,
      successFadeDurationMs: 700,
      successVisibleDurationMs: 2200,
    });
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
  const storySections = createStorySections({
    showMissingSnapshotAlert: shouldShowMissingSnapshotAlert(snapshotPanelState),
  });
  const setupScriptTestStatus =
    input.setupScriptTestStatus ?? (setupScriptDraft.trim().length === 0 ? "blank" : "idle");

  return (
    <QueryClientProvider client={queryClient}>
      <SandboxProfileEditorView
        activeSectionId={activeSectionId}
        deleteProfileAutomationUsages={[]}
        deleteProfileAutomationUsagesError={null}
        deleteProfileAutomationUsagesIsPending={false}
        deleteProfileError={null}
        deleteProfileIsPending={false}
        isDeleteProfileDialogOpen={false}
        mode={mode}
        onConfirmDeleteProfile={() => {}}
        onDeleteProfileDialogOpenChange={() => {}}
        onMakeChanges={() => {}}
        onDiscardChangesAndLeaveDraft={() => {}}
        onPublish={() => {}}
        onSaveProfileName={handleProfileNameSave}
        onActiveSectionIdChange={setActiveSectionId}
        onViewActive={() => {}}
        onViewDraft={() => {}}
        profileName={profileName}
        profileNameFallback={profileName}
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
                  <SandboxProfileIntegrationsSetupSection
                    availableConnections={input.availableConnections ?? StoryIntegrationConnections}
                    availableTargets={input.availableTargets ?? StoryIntegrationTargets}
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
                    integrationSaveError={integrationSaveErrorMessage}
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
                    onIntegrationSaveErrorDismiss={() => {
                      setIntegrationSaveErrorMessage(null);
                    }}
                  />
                </SandboxProfilePanelSection>
                <SandboxProfilePanelSection>
                  <SandboxProfileSetupScriptPanel
                    onBlur={handleSetupScriptBlur}
                    onChange={setSetupScriptDraft}
                    disabled={!isEditable}
                    repositoryHandles={resolveSandboxBaseRepositoryHandles(integrationRows)}
                    saveStatus={setupScriptSaveStatus}
                    testControl={
                      <SandboxProfileSetupScriptTestButton
                        isDraft={mode.kind === "draft"}
                        status={setupScriptTestStatus}
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
                version={snapshotStatus === "draft-unavailable" ? null : 1}
              />
            );
          }

          throw new Error("Unhandled story section.");
        }}
        sections={storySections}
      />
    </QueryClientProvider>
  );
}

function SandboxProfileEditorPageStory(
  input: SandboxProfileEditorPageStoryArgs,
): React.JSX.Element {
  const [router] = useState(() =>
    createMemoryRouter(
      createRoutesFromElements(
        <Route element={<SandboxProfileEditorPageStoryView {...input} />} path="/" />,
      ),
      {
        initialEntries: ["/"],
      },
    ),
  );

  return <RouterProvider router={router} />;
}

const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Page",
  component: SandboxProfileEditorPageStory,
  decorators: [withDashboardPageStory],
  render: function RenderStory(args): React.JSX.Element {
    return <SandboxProfileEditorPageStory {...args} />;
  },
  args: {
    displayName: "Customer Support Sandbox",
    setupScript: `#!/usr/bin/env bash
set -euo pipefail

pnpm install
pnpm dev:bootstrap`,
  },
} satisfies Meta<typeof SandboxProfileEditorPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Published: Story = {
  args: {
    lifecycleState: "published",
  },
};

export const SnapshotUnavailableNoPublishedVersion: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "draft",
    snapshotState: "draft-unavailable",
  },
};

export const SnapshotNoSnapshot: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "no-snapshot",
  },
};

export const SnapshotCreating: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "creating-snapshot",
  },
};

export const PublishSuccessfulCreatingSnapshot: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    publishSuccessMessage: true,
    snapshotState: "creating-snapshot",
  },
};

export const SnapshotReady: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-ready",
  },
};

export const SnapshotRefreshScheduleNotConfigured: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotRefreshScheduleState: "none",
    snapshotState: "snapshot-ready",
  },
};

export const SnapshotRefreshScheduleExisting: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotRefreshScheduleState: "existing",
    snapshotState: "snapshot-ready",
  },
};

export const SnapshotRefreshScheduleInvalidPreview: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotRefreshScheduleState: "invalid-preview",
    snapshotState: "snapshot-ready",
  },
};

export const SnapshotRefreshScheduleSaveFailure: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotRefreshScheduleState: "save-failure",
    snapshotState: "snapshot-ready",
  },
};

export const SnapshotFailed: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed",
  },
};

export const SnapshotRefreshFailed: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "refresh-failed",
  },
};

export const IntegrationAutosaveFailure: Story = {
  args: {
    integrationSaveErrorMessage:
      "Could not save sandbox profile integrations. Changes were not applied.",
  },
};

export const EmptySetupScript: Story = {
  args: {
    setupScript: null,
  },
};

export const SetupScriptTestStarting: Story = {
  args: {
    setupScriptTestStatus: "starting",
  },
};

export const SetupScriptTestRunning: Story = {
  args: {
    setupScriptTestStatus: "running",
  },
};

export const SetupScriptTestSucceeded: Story = {
  args: {
    setupScriptTestStatus: "success",
  },
};

export const SetupScriptTestFailed: Story = {
  args: {
    setupScriptTestStatus: "failed",
  },
};

export const SetupScriptTestUnavailablePublished: Story = {
  args: {
    lifecycleState: "published",
    setupScriptTestStatus: "idle",
  },
};

export const ResourcesAndToolsLoadError: Story = {
  args: {
    integrationsSectionState: {
      kind: "error",
      bindingsErrorMessage: "Could not load sandbox profile integration bindings.",
      directoryErrorMessage: "Could not load integration connections.",
    },
  },
};

export const StaleConnectorBinding: Story = {
  args: {
    initialBindings: [
      ...StoryBindings,
      {
        id: "binding-stale-connector",
        connectionId: "connection-missing",
        kind: "connector",
        config: {},
      },
    ],
  },
};

export const StaleConnectorMissingTarget: Story = {
  args: {
    availableConnections: StoryIntegrationConnections,
    availableTargets: StoryIntegrationTargets.filter(
      (target) => target.targetKey !== StorySlackConnection.targetKey,
    ),
    initialBindings: [
      ...StoryBindings,
      {
        id: "binding-stale-connector-missing-target",
        connectionId: StorySlackConnection.id,
        kind: "connector",
        config: {},
      },
    ],
  },
};

export const StaleGitProviderBinding: Story = {
  args: {
    initialBindings: [
      ...StoryBindings.filter((binding) => binding.kind !== "git"),
      {
        id: "binding-stale-git",
        connectionId: "missing-git-connection",
        kind: "git",
        config: {},
      },
    ],
  },
};

export const StaleGitProviderMissingTarget: Story = {
  args: {
    availableConnections: StoryIntegrationConnections,
    availableTargets: StoryIntegrationTargets.filter(
      (target) => target.targetKey !== StoryGithubConnection.targetKey,
    ),
    initialBindings: [
      ...StoryBindings,
      {
        id: "binding-stale-git-missing-target",
        connectionId: StoryGithubConnection.id,
        kind: "git",
        config: {},
      },
    ],
  },
};
