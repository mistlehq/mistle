import { systemScheduler, type TimerHandle } from "@mistle/time";
import {
  Button,
  ButtonGroup,
  DefinitionList,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  NoticeAutoHideDurationsMs,
  Switch,
} from "@mistle/ui";
import { WarningCircleIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { SingleSelectStringComboboxField } from "../forms/single-select-string-combobox-field.js";
import { ActivityStatus } from "../shared/activity-status.js";
import {
  clearPendingStatusTimeouts,
  scheduleSavedStateReset,
} from "../shared/auto-save-behavior.js";
import { FormPageSection } from "../shared/form-page.js";
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
  createTimezoneOptions,
  formatCronExpressionBreakdownDiagram,
  resolveCronExpressionBreakdown,
  resolveSnapshotRefreshScheduleBehaviorDescription,
} from "./sandbox-profile-editor-page-model.js";
import {
  SandboxProfileIntegrationsSetupUnavailableState,
  SandboxProfileEditorView,
  SandboxProfilePanelSection,
  SandboxProfileSetupScriptPanel,
} from "./sandbox-profile-editor-page.js";
import type { SandboxProfileEditorSection } from "./sandbox-profile-editor-sections.js";
import { SandboxProfileIntegrationsSetupSection } from "./sandbox-profile-integrations-setup-section.js";
import { mapBindingsToEditorRows } from "./sandbox-profile-integrations-state.js";

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
  refreshScheduleState: SnapshotRefreshScheduleStoryState;
  status: SnapshotStoryStatus;
}): React.JSX.Element {
  const state = SnapshotStoryStates[input.status];

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        A snapshot is the prepared sandbox image created from this published profile version and its
        setup script. New sessions can only start after a snapshot is ready.
      </p>

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

      <FormPageSection>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <DefinitionList
              className="min-w-0 flex-1 md:grid-cols-1"
              items={[
                {
                  id: "snapshot-created",
                  label: "Latest snapshot",
                  value: state.latestSnapshotCreatedAt ?? "N/A",
                },
              ]}
            />

            {state.activityLabel === null ? null : (
              <ActivityStatus
                className="shrink-0 justify-start text-muted-foreground sm:min-w-48 sm:justify-end"
                label={state.activityLabel}
                labelKey={input.status}
              />
            )}

            {state.activityLabel !== null || state.bodyActionLabel === null ? null : (
              <Button className="w-fit shrink-0" type="button">
                {state.bodyActionLabel}
              </Button>
            )}
          </div>
        </div>
      </FormPageSection>

      {input.status === "draft-unavailable" ? null : (
        <SandboxProfileSnapshotRefreshScheduleStorySection state={input.refreshScheduleState} />
      )}
    </div>
  );
}

function SandboxProfileSnapshotRefreshScheduleStorySection(input: {
  state: SnapshotRefreshScheduleStoryState;
}): React.JSX.Element {
  const existingSchedule =
    input.state === "existing"
      ? {
          cronExpression: "0 9 * * 1",
          nextScheduledAt: "2026-05-04T01:00:00.000Z",
          timezone: "Asia/Singapore",
        }
      : null;
  const [cronExpression, setCronExpression] = useState(
    input.state === "invalid-preview"
      ? "*/15 9 * * *"
      : (existingSchedule?.cronExpression ?? "0 9 * * *"),
  );
  const [scheduleEnabled, setScheduleEnabled] = useState(
    existingSchedule !== null ||
      input.state === "invalid-preview" ||
      input.state === "save-failure",
  );
  const [timezone, setTimezone] = useState(existingSchedule?.timezone ?? "Asia/Singapore");
  const timezoneOptions = createTimezoneOptions(existingSchedule?.timezone ?? null);
  const scheduleBehaviorDescription = resolveSnapshotRefreshScheduleBehaviorDescription({
    after: new Date("2026-04-29T00:00:00.000Z"),
    cronExpression,
    timezone,
  });
  const cronExpressionBreakdown = resolveCronExpressionBreakdown(cronExpression);
  const scheduleStatusMessage = scheduleEnabled
    ? existingSchedule === null
      ? "Automatic refresh will start after a schedule is saved."
      : "Automatic refresh is enabled for this published version."
    : "Snapshots will not refresh automatically.";

  return (
    <FormPageSection>
      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <div className="flex flex-col gap-4 p-4">
          <div className="space-y-1">
            <div className="flex min-h-10 items-center justify-between gap-3">
              <div className="space-y-1">
                <FieldLabel htmlFor="storybook-snapshot-refresh-enabled">
                  Automatic refresh
                </FieldLabel>
                <p className="text-sm text-muted-foreground">{scheduleStatusMessage}</p>
              </div>
              <Switch
                aria-label="Automatic refresh"
                checked={scheduleEnabled}
                id="storybook-snapshot-refresh-enabled"
                onCheckedChange={(checked) => {
                  setScheduleEnabled(checked);
                }}
              />
            </div>
          </div>

          {input.state === "save-failure" ? (
            <Notice title="Schedule update failed" variant="alert">
              Could not save snapshot refresh schedule.
            </Notice>
          ) : null}

          {existingSchedule === null || !scheduleEnabled ? null : (
            <DefinitionList
              items={[
                {
                  id: "snapshot-refresh-cron",
                  label: "Cron",
                  value: existingSchedule.cronExpression,
                },
                {
                  id: "snapshot-refresh-timezone",
                  label: "Timezone",
                  value: existingSchedule.timezone,
                },
                {
                  id: "snapshot-refresh-next",
                  label: "Next refresh",
                  value: existingSchedule.nextScheduledAt,
                },
              ]}
            />
          )}

          {scheduleEnabled ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldHeader>
                    <FieldLabel htmlFor="storybook-snapshot-refresh-cron">
                      Cron expression
                    </FieldLabel>
                  </FieldHeader>
                  <FieldContent>
                    <Input
                      id="storybook-snapshot-refresh-cron"
                      onChange={(event) => {
                        setCronExpression(event.target.value);
                      }}
                      value={cronExpression}
                    />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldHeader>
                    <FieldLabel htmlFor="storybook-snapshot-refresh-timezone">Timezone</FieldLabel>
                  </FieldHeader>
                  <FieldContent>
                    <SingleSelectStringComboboxField
                      contentClassName="max-h-80"
                      emptyMessage="No matching timezones."
                      inputId="storybook-snapshot-refresh-timezone"
                      inputLabel="Timezone"
                      onChange={(value) => {
                        setTimezone(value ?? "");
                      }}
                      options={timezoneOptions}
                      placeholder="Asia/Singapore"
                      value={timezone}
                    />
                  </FieldContent>
                </Field>
              </div>

              <StoryCronExpressionBreakdownList
                breakdown={cronExpressionBreakdown}
                message={scheduleBehaviorDescription}
              />
            </>
          ) : null}

          {scheduleEnabled || existingSchedule !== null ? (
            <ButtonGroup>
              <Button type="submit">{scheduleEnabled ? "Save schedule" : "Save changes"}</Button>
            </ButtonGroup>
          ) : null}
        </div>
      </form>
    </FormPageSection>
  );
}

function StoryCronExpressionBreakdownList(input: {
  breakdown: ReturnType<typeof resolveCronExpressionBreakdown>;
  message: string;
}): React.JSX.Element {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm" aria-label="Cron breakdown">
      {input.breakdown === null ? (
        <p className="text-muted-foreground">{input.message}</p>
      ) : (
        <pre className="overflow-x-auto rounded-sm bg-background p-2 font-mono text-xs leading-5 text-muted-foreground">
          {formatCronExpressionBreakdownDiagram(input.breakdown)}
        </pre>
      )}
    </div>
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
  const storySections = createStorySections({
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
                    value={setupScriptDraft}
                  />
                </SandboxProfilePanelSection>
              </div>
            );
          }

          if (sectionId === "snapshot") {
            return (
              <SandboxProfileSnapshotStoryPanel
                publishSuccessMessage={input.publishSuccessMessage === true}
                refreshScheduleState={input.snapshotRefreshScheduleState ?? "none"}
                status={snapshotStatus}
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
