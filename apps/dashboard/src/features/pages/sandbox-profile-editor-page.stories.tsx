import { systemScheduler, type TimerHandle } from "@mistle/time";
import { Button, DefinitionList, Notice, NoticeAutoHideDurationsMs } from "@mistle/ui";
import { WarningCircleIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";
import { userEvent, within } from "storybook/test";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { ActivityStatus } from "../shared/activity-status.js";
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
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  SandboxProfileIntegrationsSetupUnavailableState,
  SandboxProfileEditorView,
  SandboxProfileSetupScriptPanel,
} from "./sandbox-profile-editor-page.js";
import type { SandboxProfileEditorSection } from "./sandbox-profile-editor-sections.js";
import { SandboxProfileIntegrationsSetupSection } from "./sandbox-profile-integrations-setup-section.js";
import { mapBindingsToEditorRows } from "./sandbox-profile-integrations-state.js";
import { SandboxProfileResourcesAndToolsSection } from "./sandbox-profile-resources-and-tools-section.js";

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
};

type IntegrationsSectionState = NonNullable<
  SandboxProfileEditorPageStoryArgs["integrationsSectionState"]
>;
type StorySectionId = "integrations" | "resources-and-tools" | "configurations" | "snapshot";
type StoryIntegrationSetupSectionId = Extract<
  StorySectionId,
  "integrations" | "resources-and-tools"
>;

const StorySections = [
  {
    id: "integrations",
    label: "Integrations",
  },
  {
    id: "resources-and-tools",
    label: "Resources & Tools",
  },
  {
    id: "configurations",
    label: "Configurations",
  },
  {
    id: "snapshot",
    label: "Snapshot",
  },
] as const satisfies readonly SandboxProfileEditorSection<StorySectionId>[];

function createStorySections(input: {
  snapshotDisabled: boolean;
  showMissingSnapshotAlert: boolean;
}): readonly SandboxProfileEditorSection<StorySectionId>[] {
  return StorySections.map((section) =>
    section.id === "snapshot"
      ? {
          ...section,
          disabled: input.snapshotDisabled,
          sideLabel: (
            <span className="inline-flex items-center gap-1.5">
              <span>Snapshot</span>
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

function shouldShowMissingSnapshotAlert(input: {
  mode: SandboxProfileEditorVersionMode;
  snapshotStatus: SnapshotStoryStatus;
}): boolean {
  return input.mode.kind === "active" && input.snapshotStatus === "no-snapshot";
}

type SandboxProfileEditorVersionMode = React.ComponentProps<
  typeof SandboxProfileEditorView
>["mode"];

const StoryBindings = [
  {
    id: "binding-openai-agent",
    connectionId: StoryOpenAiConnection.id,
    kind: "agent" as const,
    config: {
      model: {
        defaultModel: "gpt-5.3-codex",
        options: {
          reasoningEffort: "medium",
          additionalInstructions: "Stay concise and ask before destructive changes.",
        },
      },
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

type SnapshotStoryState = {
  activityLabel: string | null;
  bodyActionLabel: string | null;
  latestSnapshotCreatedAt: string | null;
  notice: {
    title: string;
    variant: React.ComponentProps<typeof Notice>["variant"];
  } | null;
};

const SnapshotStoryStates: Record<SnapshotStoryStatus, SnapshotStoryState> = {
  "draft-unavailable": {
    activityLabel: null,
    bodyActionLabel: null,
    latestSnapshotCreatedAt: null,
    notice: {
      title: "Snapshots are available after publishing",
      variant: "default",
    },
  },
  "no-snapshot": {
    activityLabel: null,
    bodyActionLabel: "Create snapshot",
    latestSnapshotCreatedAt: null,
    notice: {
      title: "Create a snapshot to start sessions from this profile.",
      variant: "alert",
    },
  },
  "creating-snapshot": {
    activityLabel: "Creating snapshot",
    bodyActionLabel: null,
    latestSnapshotCreatedAt: null,
    notice: null,
  },
  "snapshot-ready": {
    activityLabel: null,
    bodyActionLabel: "Refresh snapshot",
    latestSnapshotCreatedAt: "Apr 27, 2026, 10:21 AM",
    notice: null,
  },
  "snapshot-failed": {
    activityLabel: null,
    bodyActionLabel: "Create snapshot",
    latestSnapshotCreatedAt: null,
    notice: {
      title: "Snapshot failed",
      variant: "alert",
    },
  },
  "refresh-failed": {
    activityLabel: null,
    bodyActionLabel: "Refresh snapshot",
    latestSnapshotCreatedAt: "Apr 27, 2026, 10:21 AM",
    notice: {
      title: "Refresh failed",
      variant: "alert",
    },
  },
};

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

function SandboxProfileSnapshotStoryPanel(input: {
  publishSuccessMessage: boolean;
  status: SnapshotStoryStatus;
}): React.JSX.Element {
  const state = SnapshotStoryStates[input.status];

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {input.publishSuccessMessage ? (
        <Notice
          autoHideAfterMs={NoticeAutoHideDurationsMs.MEDIUM}
          dismissible
          title="Publish successful, creating a snapshot"
          variant="success"
        />
      ) : null}

      {state.notice === null ? null : (
        <Notice title={state.notice.title} variant={state.notice.variant} />
      )}

      <div className="space-y-1">
        <h2 className="text-base font-semibold leading-6">About snapshots</h2>
        <p className="text-sm text-muted-foreground">
          A snapshot is the prepared sandbox image created from this published profile version and
          its setup script. New sessions can only start after a snapshot is ready.
        </p>
      </div>

      {state.bodyActionLabel === null ? null : (
        <div>
          <Button type="button">{state.bodyActionLabel}</Button>
        </div>
      )}

      {state.activityLabel === null ? null : (
        <ActivityStatus
          className="justify-start text-muted-foreground"
          label={state.activityLabel}
          labelKey={input.status}
        />
      )}

      {state.latestSnapshotCreatedAt === null ? null : (
        <DefinitionList
          items={[
            {
              id: "snapshot-created",
              label: "Latest snapshot",
              value: state.latestSnapshotCreatedAt,
            },
          ]}
        />
      )}
    </div>
  );
}

function renderUnavailableIntegrationsSectionPanel(input: {
  sectionId: StoryIntegrationSetupSectionId;
  state: IntegrationsSectionState;
}): React.JSX.Element {
  return (
    <SandboxProfileIntegrationsSetupUnavailableState
      activeSectionId={input.sectionId}
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
    input.initialSectionId ?? "integrations",
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
  const storySections = createStorySections({
    snapshotDisabled: mode.kind === "draft",
    showMissingSnapshotAlert: shouldShowMissingSnapshotAlert({
      mode,
      snapshotStatus,
    }),
  });

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
          if (
            input.integrationsSectionState !== undefined &&
            (sectionId === "integrations" || sectionId === "resources-and-tools")
          ) {
            return renderUnavailableIntegrationsSectionPanel({
              sectionId,
              state: input.integrationsSectionState,
            });
          }

          if (sectionId === "integrations") {
            return (
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
            );
          }

          if (sectionId === "resources-and-tools") {
            return (
              <SandboxProfileResourcesAndToolsSection
                availableConnections={input.availableConnections ?? StoryIntegrationConnections}
                availableTargets={input.availableTargets ?? StoryIntegrationTargets}
                disabled={!isEditable}
                onRowChange={(clientId, changes) => {
                  setIntegrationRows((currentRows) =>
                    currentRows.map((row) =>
                      row.clientId === clientId ? { ...row, ...changes } : row,
                    ),
                  );
                }}
                rows={integrationRows}
              />
            );
          }

          if (sectionId === "snapshot") {
            return (
              <SandboxProfileSnapshotStoryPanel
                publishSuccessMessage={input.publishSuccessMessage === true}
                status={snapshotStatus}
              />
            );
          }

          return (
            <SandboxProfileSetupScriptPanel
              onBlur={handleSetupScriptBlur}
              onChange={setSetupScriptDraft}
              disabled={!isEditable}
              saveStatus={setupScriptSaveStatus}
              value={setupScriptDraft}
            />
          );
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
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("tab", { name: "Configurations" }));
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
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("tab", { name: "Resources & Tools" }));
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
