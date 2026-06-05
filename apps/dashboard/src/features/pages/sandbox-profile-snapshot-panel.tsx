import {
  BrailleSpinner,
  Button,
  ButtonGroup,
  DefinitionList,
  DropdownMenuItem,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Input,
  MoreActionsMenu,
  Notice,
  NoticeAutoHideDurationsMs,
  SectionBlock,
  Switch,
} from "@mistle/ui";
import { CaretDownIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Key,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { SingleSelectStringComboboxField } from "../forms/single-select-string-combobox-field.js";
import {
  formatCompactSandboxProfileVersion,
  formatSandboxProfileVersionLabel,
} from "../sandbox-profiles/sandbox-profile-version-labels.js";
import {
  deleteSandboxProfileVersionRefreshSchedule,
  putSandboxProfileVersionRefreshSchedule,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import { formatDateTime, formatTimeZoneOffset } from "../shared/date-formatters.js";
import { SandboxOperationProgress } from "./sandbox-operation-progress.js";
import {
  createTimezoneOptions,
  formatCronExpressionBreakdownDiagram,
  resolveCronExpressionBreakdown,
  resolveSnapshotRefreshScheduleBehaviorDescription,
  type CronExpressionBreakdown,
} from "./sandbox-profile-editor-page-model.js";
import { SandboxProfileEditorHorizontalTabContent } from "./sandbox-profile-editor-sections.js";
import { SandboxProfileScriptEditorField } from "./sandbox-profile-script-editor-panel.js";
import { SandboxProfileSectionCard } from "./sandbox-profile-section-card.js";
import {
  SandboxProfileSetupScriptTestPanel,
  useSandboxProfileMaintenanceScriptTestRun,
  type SetupScriptTestButtonProps,
} from "./sandbox-profile-setup-script-test.js";

export type SnapshotPanelState =
  | {
      kind: "draft-unavailable";
    }
  | {
      kind: "creating";
      operationId: string;
      publishedVersion: number;
      runnableVersion: number | null;
      sandboxInstanceId: string | null;
    }
  | {
      kind: "ready";
      latestSnapshotCreatedAt: string | null;
      operationId: string | null;
      sandboxInstanceId: string | null;
    }
  | {
      kind: "publish-snapshot-error";
      operationId: string | null;
      publishedVersion: number;
      runnableVersion: number | null;
      sandboxInstanceId: string | null;
    }
  | {
      kind: "refresh-error";
      latestSnapshotCreatedAt: string | null;
      message: string;
      operationId: string | null;
      sandboxInstanceId: string | null;
    };

type SnapshotStatusState = Extract<
  SnapshotPanelState,
  { kind: "creating" | "publish-snapshot-error" | "ready" | "refresh-error" }
>;
type SnapshotActionState = Exclude<SnapshotStatusState, { kind: "creating" }>;

type SnapshotOperationProgressState = {
  operationId: string;
  sandboxInstanceId: string | null;
};
type SnapshotMaintenanceScriptAssistantControl = {
  disabled: boolean;
  isStarting: boolean;
  onToggle: () => void;
  title: string;
};

const DefaultSnapshotRefreshCronExpression = "0 9 * * *";

export type SnapshotRefreshSchedule = SandboxProfileVersion["refreshSchedule"];
export type SnapshotRefreshScheduleInput = {
  cronExpression: string;
  maintenanceScript: string | null;
  timezone: string;
};

type SnapshotRefreshScheduleDraft = {
  cronExpression: string;
  timezone: string;
};

function resolveSnapshotRefreshScheduleDraft(input: {
  existingSchedule: SnapshotRefreshSchedule;
  initialDraft: SnapshotRefreshScheduleDraft | undefined;
}): SnapshotRefreshScheduleDraft {
  return {
    cronExpression:
      input.initialDraft?.cronExpression ??
      input.existingSchedule?.cronExpression ??
      DefaultSnapshotRefreshCronExpression,
    timezone:
      input.initialDraft?.timezone ?? input.existingSchedule?.timezone ?? readBrowserTimeZone(),
  };
}

function formatSnapshotRefreshNextScheduledAt(input: {
  nextScheduledAt: string;
  timezone: string;
}): string {
  return `${formatDateTime(input.nextScheduledAt, input.timezone)} ${formatTimeZoneOffset({
    isoDateTime: input.nextScheduledAt,
    timeZone: input.timezone,
  })}`;
}

export function formatSnapshotTimestamp(isoDateTime: string): string {
  const timezone = readBrowserTimeZone();
  return `${formatDateTime(isoDateTime, timezone)} ${formatTimeZoneOffset({
    isoDateTime,
    timeZone: timezone,
  })}`;
}

export function resolveSnapshotPanelState(
  version: SandboxProfileVersion | null,
  activeVersion: number | null,
): SnapshotPanelState {
  if (version === null) {
    return {
      kind: "draft-unavailable",
    };
  }

  const latestSnapshotJob = version.latestSnapshotJob;
  if (latestSnapshotJob?.state === "queued" || latestSnapshotJob?.state === "running") {
    return {
      kind: "creating",
      operationId: latestSnapshotJob.id,
      publishedVersion: version.version,
      runnableVersion: activeVersion,
      sandboxInstanceId: latestSnapshotJob.sandboxInstanceId,
    };
  }

  if (latestSnapshotJob?.state === "failed") {
    if (!version.usable) {
      return {
        kind: "publish-snapshot-error",
        operationId: latestSnapshotJob.id,
        publishedVersion: version.version,
        runnableVersion: activeVersion,
        sandboxInstanceId: latestSnapshotJob.sandboxInstanceId,
      };
    }

    const message = latestSnapshotJob.errorMessage ?? "Snapshot materialization failed.";
    return {
      kind: "refresh-error",
      latestSnapshotCreatedAt: null,
      message,
      operationId: latestSnapshotJob.id,
      sandboxInstanceId: latestSnapshotJob.sandboxInstanceId,
    };
  }

  if (!version.usable) {
    return {
      kind: "publish-snapshot-error",
      operationId: null,
      publishedVersion: version.version,
      runnableVersion: activeVersion,
      sandboxInstanceId: null,
    };
  }

  return {
    kind: "ready",
    latestSnapshotCreatedAt:
      latestSnapshotJob?.state === "succeeded"
        ? (latestSnapshotJob.finishedAt ?? version.publishedAt)
        : version.publishedAt,
    operationId: latestSnapshotJob?.state === "succeeded" ? latestSnapshotJob.id : null,
    sandboxInstanceId:
      latestSnapshotJob?.state === "succeeded" ? latestSnapshotJob.sandboxInstanceId : null,
  };
}

export function SandboxProfileSnapshotPanel(input: {
  isActionPending: boolean;
  invalidateProfileVersions: (profileId: string) => Promise<void>;
  maintenanceScript: string | null;
  onPublishSuccessMessageDismiss: () => void;
  onMaintenanceRefreshSnapshot: () => void;
  onRefreshSnapshot: () => void;
  onRetryPublishSnapshot: () => void;
  publishSuccessMessageKey: Key;
  publishSuccessMessage: boolean;
  profileId: string;
  refreshSchedule: SnapshotRefreshSchedule;
  setupAssistantControl: SnapshotMaintenanceScriptAssistantControl;
  state: SnapshotPanelState;
  canRunMaintenanceScript: boolean;
  canRunMaintenanceRefresh: boolean;
  version: number | null;
}): React.JSX.Element {
  const showMaintenanceRefreshAction =
    input.refreshSchedule !== null && (input.maintenanceScript?.trim().length ?? 0) > 0;

  return (
    <SandboxProfileSnapshotPanelView
      canRunMaintenanceRefresh={input.canRunMaintenanceRefresh}
      isActionPending={input.isActionPending}
      onMaintenanceRefreshSnapshot={input.onMaintenanceRefreshSnapshot}
      onPublishSuccessMessageDismiss={input.onPublishSuccessMessageDismiss}
      onRefreshSnapshot={input.onRefreshSnapshot}
      onRetryPublishSnapshot={input.onRetryPublishSnapshot}
      publishSuccessMessage={input.publishSuccessMessage}
      publishSuccessMessageKey={input.publishSuccessMessageKey}
      refreshScheduleSection={
        input.version === null ? null : (
          <SandboxProfileSnapshotRefreshScheduleSection
            canRunMaintenanceScript={input.canRunMaintenanceScript}
            disabled={input.isActionPending}
            invalidateProfileVersions={input.invalidateProfileVersions}
            maintenanceScript={input.maintenanceScript}
            profileId={input.profileId}
            refreshSchedule={input.refreshSchedule}
            setupAssistantControl={input.setupAssistantControl}
            version={input.version}
          />
        )
      }
      showMaintenanceRefreshAction={showMaintenanceRefreshAction}
      state={input.state}
      version={input.version}
    />
  );
}

export function SandboxProfileSnapshotPanelView(input: {
  canRunMaintenanceRefresh: boolean;
  isActionPending: boolean;
  onMaintenanceRefreshSnapshot: () => void;
  onPublishSuccessMessageDismiss: () => void;
  onRefreshSnapshot: () => void;
  onRetryPublishSnapshot: () => void;
  publishSuccessMessageKey: Key;
  publishSuccessMessage: boolean;
  refreshScheduleSection: ReactNode;
  showMaintenanceRefreshAction: boolean;
  state: SnapshotPanelState;
  version: number | null;
}): React.JSX.Element {
  const operationProgressState = useRetainedSnapshotOperationState(input.state);
  const shouldDefaultDetailsExpanded =
    operationProgressState !== null &&
    (input.state.kind === "creating" ||
      input.state.kind === "publish-snapshot-error" ||
      input.state.kind === "refresh-error");
  const [detailsExpanded, setDetailsExpanded] = useState(() => shouldDefaultDetailsExpanded);

  useEffect(() => {
    setDetailsExpanded(shouldDefaultDetailsExpanded);
  }, [
    shouldDefaultDetailsExpanded,
    input.state.kind,
    operationProgressState?.operationId,
    operationProgressState?.sandboxInstanceId,
  ]);

  if (input.state.kind === "draft-unavailable" || input.version === null) {
    return (
      <SandboxProfileEditorHorizontalTabContent>
        <SnapshotPanelDescription />

        <Notice title="Publish this sandbox profile before managing snapshots.">
          Snapshots are available after the sandbox profile has a published version.
        </Notice>
      </SandboxProfileEditorHorizontalTabContent>
    );
  }

  return (
    <SandboxProfileEditorHorizontalTabContent>
      <SnapshotPanelDescription />

      <PublishSuccessSnapshotNotice
        onDismiss={input.onPublishSuccessMessageDismiss}
        noticeKey={input.publishSuccessMessageKey}
        visible={input.publishSuccessMessage}
      />

      {input.state.kind === "publish-snapshot-error" ? (
        <Notice title="Snapshot creation failed" variant="alert">
          {formatPublishSnapshotFailureMessage({
            publishedVersion: input.state.publishedVersion,
            runnableVersion: input.state.runnableVersion,
          })}
        </Notice>
      ) : null}

      {input.state.kind === "refresh-error" ? (
        <Notice title="Refresh failed" variant="alert">
          {input.state.message}
        </Notice>
      ) : null}

      <SnapshotStatusPanel
        canRunMaintenanceRefresh={input.canRunMaintenanceRefresh}
        detailsExpanded={detailsExpanded}
        isActionPending={input.isActionPending}
        onDetailsExpandedChange={setDetailsExpanded}
        onMaintenanceRefreshSnapshot={input.onMaintenanceRefreshSnapshot}
        onRefreshSnapshot={input.onRefreshSnapshot}
        onRetryPublishSnapshot={input.onRetryPublishSnapshot}
        operationProgressState={operationProgressState}
        showMaintenanceRefreshAction={input.showMaintenanceRefreshAction}
        state={input.state}
        version={input.version}
      />

      {input.refreshScheduleSection}
    </SandboxProfileEditorHorizontalTabContent>
  );
}

function SnapshotStatusPanel(input: {
  canRunMaintenanceRefresh: boolean;
  detailsExpanded: boolean;
  isActionPending: boolean;
  onDetailsExpandedChange: (expanded: boolean) => void;
  onMaintenanceRefreshSnapshot: () => void;
  onRefreshSnapshot: () => void;
  onRetryPublishSnapshot: () => void;
  operationProgressState: SnapshotOperationProgressState | null;
  showMaintenanceRefreshAction: boolean;
  state: SnapshotStatusState;
  version: number;
}): React.JSX.Element {
  const operationProgressState = input.operationProgressState;
  const hasDetails = operationProgressState !== null;

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">
            {resolveSnapshotStatusTitle({
              state: input.state,
              version: input.version,
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {resolveSnapshotStatusSummaryDescription(input.state)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {input.state.kind === "creating" ? (
            <span
              aria-label="Creating snapshot"
              aria-live="polite"
              className="sr-only"
              role="status"
            >
              Creating snapshot
            </span>
          ) : null}
          {hasDetails ? (
            <button
              aria-expanded={input.detailsExpanded}
              className="focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-9 w-fit shrink-0 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px]"
              onClick={() => {
                input.onDetailsExpandedChange(!input.detailsExpanded);
              }}
              type="button"
            >
              {input.state.kind === "creating" ? (
                <>
                  <BrailleSpinner className="text-muted-foreground" />
                  <span>Creating snapshot</span>
                </>
              ) : (
                "Snapshot creation details"
              )}
              <CaretDownIcon
                aria-hidden
                className={`size-4 transition-transform ${
                  input.detailsExpanded ? "" : "-rotate-90"
                }`}
              />
            </button>
          ) : null}
          {input.state.kind === "creating" ? null : (
            <SnapshotStatusAction
              canRunMaintenanceRefresh={input.canRunMaintenanceRefresh}
              isActionPending={input.isActionPending}
              onMaintenanceRefreshSnapshot={input.onMaintenanceRefreshSnapshot}
              onRefreshSnapshot={input.onRefreshSnapshot}
              onRetryPublishSnapshot={input.onRetryPublishSnapshot}
              showMaintenanceRefreshAction={input.showMaintenanceRefreshAction}
              state={input.state}
            />
          )}
        </div>
      </div>

      {operationProgressState !== null && input.detailsExpanded ? (
        <div className="border-t border-border bg-background/60">
          <SandboxOperationProgress
            emptyMessage="Waiting for snapshot creation events."
            operationId={operationProgressState.operationId}
            sandboxInstanceId={operationProgressState.sandboxInstanceId}
            showBorder={false}
            showLoadError={false}
          />
        </div>
      ) : null}
    </section>
  );
}

function useRetainedSnapshotOperationState(
  state: SnapshotPanelState,
): SnapshotOperationProgressState | null {
  const [retainedState, setRetainedState] = useState<SnapshotOperationProgressState | null>(
    resolveRetainedSnapshotOperationState({
      retainedState: null,
      state,
    }),
  );

  useEffect(() => {
    setRetainedState((currentRetainedState) =>
      resolveRetainedSnapshotOperationState({
        retainedState: currentRetainedState,
        state,
      }),
    );
  }, [state]);

  return retainedState;
}

export function resolveRetainedSnapshotOperationState(input: {
  retainedState: SnapshotOperationProgressState | null;
  state: SnapshotPanelState;
}): SnapshotOperationProgressState | null {
  if (input.state.kind === "creating") {
    return {
      operationId: input.state.operationId,
      sandboxInstanceId: input.state.sandboxInstanceId,
    };
  }

  if (input.state.kind === "ready" && input.state.operationId !== null) {
    return {
      operationId: input.state.operationId,
      sandboxInstanceId: input.state.sandboxInstanceId,
    };
  }

  if (
    (input.state.kind === "publish-snapshot-error" || input.state.kind === "refresh-error") &&
    input.state.operationId !== null
  ) {
    return {
      operationId: input.state.operationId,
      sandboxInstanceId: input.state.sandboxInstanceId,
    };
  }

  return input.retainedState;
}

function SnapshotStatusAction(input: {
  canRunMaintenanceRefresh: boolean;
  isActionPending: boolean;
  onMaintenanceRefreshSnapshot: () => void;
  onRefreshSnapshot: () => void;
  onRetryPublishSnapshot: () => void;
  showMaintenanceRefreshAction: boolean;
  state: SnapshotActionState;
}): React.JSX.Element {
  if (input.state.kind === "publish-snapshot-error") {
    return (
      <Button
        className="w-fit shrink-0"
        disabled={input.isActionPending}
        onClick={input.onRetryPublishSnapshot}
        type="button"
      >
        Retry snapshot creation
      </Button>
    );
  }

  return (
    <ButtonGroup>
      {input.showMaintenanceRefreshAction ? (
        <>
          <Button
            className="w-fit shrink-0"
            disabled={input.isActionPending || !input.canRunMaintenanceRefresh}
            onClick={input.onMaintenanceRefreshSnapshot}
            type="button"
          >
            Refresh snapshot (maintenance)
          </Button>
          <MoreActionsMenu
            disabled={input.isActionPending}
            triggerIconVariant="chevron-down"
            triggerLabel="Snapshot refresh actions"
            triggerVariant="default"
          >
            <DropdownMenuItem onClick={input.onRefreshSnapshot}>
              Refresh snapshot (setup script)
            </DropdownMenuItem>
          </MoreActionsMenu>
        </>
      ) : (
        <Button
          className="w-fit shrink-0"
          disabled={input.isActionPending}
          onClick={input.onRefreshSnapshot}
          type="button"
        >
          Refresh snapshot (setup script)
        </Button>
      )}
    </ButtonGroup>
  );
}

function SnapshotPanelDescription(): React.JSX.Element {
  return (
    <p className="text-sm text-muted-foreground">
      A snapshot is the prepared sandbox image for this published profile version. New sessions can
      only start after a snapshot is ready.
    </p>
  );
}

function formatPublishSnapshotFailureMessage(input: {
  publishedVersion: number;
  runnableVersion: number | null;
}): string {
  const publishedVersion = formatSandboxProfileVersionLabel(input.publishedVersion);
  if (input.runnableVersion === null) {
    return `${publishedVersion} was published, but its snapshot could not be created. New sessions and triggers cannot use this profile until the snapshot is retried successfully.`;
  }

  return `${publishedVersion} was published, but its snapshot could not be created. New sessions and triggers will continue using ${formatCompactSandboxProfileVersion(input.runnableVersion)} until the snapshot is retried successfully.`;
}

function resolveSnapshotStatusSummaryDescription(state: SnapshotStatusState): string {
  if (state.kind === "ready" || state.kind === "refresh-error") {
    return `Latest snapshot: ${
      state.latestSnapshotCreatedAt === null
        ? "N/A"
        : formatSnapshotTimestamp(state.latestSnapshotCreatedAt)
    }`;
  }

  const fallbackVersion =
    state.runnableVersion !== null
      ? formatCompactSandboxProfileVersion(state.runnableVersion)
      : null;

  return resolveSnapshotStatusDescription({
    fallbackVersion,
    state,
  });
}

function resolveSnapshotStatusTitle(input: {
  state: SnapshotStatusState;
  version: number;
}): string {
  if (input.state.kind === "ready" || input.state.kind === "refresh-error") {
    return `Sandbox Profile ${formatCompactSandboxProfileVersion(input.version)}'s snapshot is ready`;
  }

  const currentVersion = formatCompactSandboxProfileVersion(input.state.publishedVersion);
  return input.state.kind === "creating"
    ? `Sandbox Profile ${currentVersion}'s snapshot is being created`
    : `Sandbox Profile ${currentVersion}'s snapshot is unavailable`;
}

function resolveSnapshotStatusDescription(input: {
  fallbackVersion: string | null;
  state: SnapshotStatusState;
}): string {
  if (input.fallbackVersion === null) {
    return input.state.kind === "creating"
      ? "New sessions and triggers will be available after snapshot creation succeeds."
      : "Sessions and triggers are blocked until snapshot creation succeeds.";
  }

  return input.state.kind === "creating"
    ? `Interim, ${input.fallbackVersion}'s snapshot will be used for new sessions and triggers.`
    : `${input.fallbackVersion}'s snapshot will be used for new sessions and triggers.`;
}

function SandboxProfileSnapshotRefreshScheduleSection(input: {
  canRunMaintenanceScript: boolean;
  disabled: boolean;
  invalidateProfileVersions: (profileId: string) => Promise<void>;
  maintenanceScript: string | null;
  profileId: string;
  refreshSchedule: SnapshotRefreshSchedule;
  setupAssistantControl: SnapshotMaintenanceScriptAssistantControl;
  version: number;
}): React.JSX.Element {
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [maintenanceScriptDraft, setMaintenanceScriptDraft] = useState(
    input.maintenanceScript ?? "",
  );
  const [persistedMaintenanceScript, setPersistedMaintenanceScript] = useState(
    input.maintenanceScript ?? "",
  );
  const [pendingExternalMaintenanceScript, setPendingExternalMaintenanceScript] = useState<
    string | null
  >(null);
  const previousRefreshScheduleRef = useRef(input.refreshSchedule);
  const previousMaintenanceScriptRef = useRef(input.maintenanceScript);
  const maintenanceScriptDraftRef = useRef(maintenanceScriptDraft);
  const persistedMaintenanceScriptRef = useRef(persistedMaintenanceScript);
  maintenanceScriptDraftRef.current = maintenanceScriptDraft;
  persistedMaintenanceScriptRef.current = persistedMaintenanceScript;
  const saveScheduleMutation = useMutation({
    mutationFn: async (schedule: SnapshotRefreshScheduleInput) => {
      if (schedule.cronExpression.length === 0 || schedule.timezone.length === 0) {
        throw new Error("Enter a cron expression and timezone.");
      }

      return putSandboxProfileVersionRefreshSchedule({
        profileId: input.profileId,
        version: input.version,
        cronExpression: schedule.cronExpression,
        timezone: schedule.timezone,
        maintenanceScript: schedule.maintenanceScript,
      });
    },
    onSuccess: async (_result, schedule) => {
      const nextMaintenanceScript = schedule.maintenanceScript ?? "";
      setMutationError(null);
      setMaintenanceScriptDraft(nextMaintenanceScript);
      setPersistedMaintenanceScript(nextMaintenanceScript);
      setPendingExternalMaintenanceScript(null);
      await input.invalidateProfileVersions(input.profileId);
    },
    onError: (error: unknown) => {
      setMutationError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not save snapshot refresh schedule.",
        }),
      );
    },
  });
  const removeScheduleMutation = useMutation({
    mutationFn: async () =>
      deleteSandboxProfileVersionRefreshSchedule({
        profileId: input.profileId,
        version: input.version,
      }),
    onSuccess: async () => {
      setMutationError(null);
      await input.invalidateProfileVersions(input.profileId);
    },
    onError: (error: unknown) => {
      setMutationError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not remove snapshot refresh schedule.",
        }),
      );
    },
  });
  const isMutating = saveScheduleMutation.isPending || removeScheduleMutation.isPending;

  useEffect(() => {
    if (previousRefreshScheduleRef.current !== input.refreshSchedule) {
      previousRefreshScheduleRef.current = input.refreshSchedule;
      setMutationError(null);
    }
  }, [input.refreshSchedule]);

  useEffect(() => {
    const previousMaintenanceScript = previousMaintenanceScriptRef.current;
    previousMaintenanceScriptRef.current = input.maintenanceScript;

    if (input.maintenanceScript === previousMaintenanceScript) {
      return;
    }

    const nextValue = input.maintenanceScript ?? "";
    setPersistedMaintenanceScript(nextValue);
    setMutationError(null);

    if (
      maintenanceScriptDraftRef.current === persistedMaintenanceScriptRef.current ||
      maintenanceScriptDraftRef.current === nextValue
    ) {
      setMaintenanceScriptDraft(nextValue);
      setPendingExternalMaintenanceScript(null);
      return;
    }

    setPendingExternalMaintenanceScript(nextValue);
  }, [input.maintenanceScript]);

  function handleChangeMaintenanceScript(nextValue: string): void {
    setMaintenanceScriptDraft(nextValue);
    setPendingExternalMaintenanceScript((currentValue) =>
      currentValue === nextValue ? null : currentValue,
    );
    setMutationError(null);
  }

  function applyPendingExternalMaintenanceScript(): void {
    if (pendingExternalMaintenanceScript === null) {
      return;
    }

    setMaintenanceScriptDraft(pendingExternalMaintenanceScript);
    setPersistedMaintenanceScript(pendingExternalMaintenanceScript);
    setPendingExternalMaintenanceScript(null);
    setMutationError(null);
  }

  const maintenanceScriptHasChanges = maintenanceScriptDraft !== persistedMaintenanceScript;
  const maintenanceScriptTest = useSandboxProfileMaintenanceScriptTestRun({
    canRun: input.canRunMaintenanceScript,
    disabled: input.disabled || isMutating,
    maintenanceScript: maintenanceScriptDraft,
    profileId: input.profileId,
    version: input.version,
  });

  return (
    <SandboxProfileSnapshotRefreshScheduleForm
      disabled={input.disabled || isMutating}
      existingSchedule={input.refreshSchedule}
      maintenanceScriptDraft={maintenanceScriptDraft}
      maintenanceScriptHasChanges={maintenanceScriptHasChanges}
      savedMaintenanceScript={persistedMaintenanceScript}
      mutationError={mutationError}
      onApplyPendingExternalMaintenanceScript={applyPendingExternalMaintenanceScript}
      onChangeMaintenanceScript={handleChangeMaintenanceScript}
      onDeleteSchedule={() => {
        removeScheduleMutation.mutate();
      }}
      onDismissPendingExternalMaintenanceScript={() => {
        setPendingExternalMaintenanceScript(null);
      }}
      onSaveSchedule={(schedule) => {
        saveScheduleMutation.mutate(schedule);
      }}
      pendingExternalMaintenanceScript={pendingExternalMaintenanceScript !== null}
      previewAfter={new Date()}
      setupAssistantControl={input.setupAssistantControl}
      testButtonProps={maintenanceScriptTest.buttonProps}
      testPanel={<SandboxProfileSetupScriptTestPanel {...maintenanceScriptTest.panelProps} />}
    />
  );
}

function SnapshotMaintenanceScriptSummaryValue(input: { script: string }): React.JSX.Element {
  if (input.script.trim().length === 0) {
    return (
      <span className="text-muted-foreground">
        Not configured. Automatic refresh uses <ScriptTermEmphasis>setup script</ScriptTermEmphasis>
        .
      </span>
    );
  }

  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-sm bg-muted/40 p-2 font-mono text-xs leading-5 text-muted-foreground">
      {input.script}
    </pre>
  );
}

function ScriptTermEmphasis(input: { children: ReactNode }): React.JSX.Element {
  return <strong className="font-medium text-foreground">{input.children}</strong>;
}

export function SandboxProfileSnapshotRefreshScheduleForm(input: {
  disabled: boolean;
  existingSchedule: SnapshotRefreshSchedule;
  initialDraft?: SnapshotRefreshScheduleDraft;
  maintenanceScriptDraft: string;
  maintenanceScriptHasChanges: boolean;
  mutationError: string | null;
  onApplyPendingExternalMaintenanceScript: () => void;
  onChangeMaintenanceScript: (nextValue: string) => void;
  onDeleteSchedule: () => void;
  onDismissPendingExternalMaintenanceScript: () => void;
  onSaveSchedule: (schedule: SnapshotRefreshScheduleInput) => void;
  pendingExternalMaintenanceScript: boolean;
  previewAfter: Date;
  savedMaintenanceScript: string;
  setupAssistantControl: SnapshotMaintenanceScriptAssistantControl;
  testButtonProps: SetupScriptTestButtonProps;
  testPanel: ReactNode;
}): React.JSX.Element {
  const existingSchedule = input.existingSchedule;
  const savedMaintenanceScriptHasContent = input.savedMaintenanceScript.trim().length > 0;
  const hasInitialDraft = input.initialDraft !== undefined;
  const resolvedDraft = resolveSnapshotRefreshScheduleDraft({
    existingSchedule,
    initialDraft: input.initialDraft,
  });
  const [scheduleEnabled, setScheduleEnabled] = useState(
    existingSchedule !== null || hasInitialDraft,
  );
  const [isEditingSchedule, setIsEditingSchedule] = useState(hasInitialDraft);
  const [cronExpression, setCronExpression] = useState(resolvedDraft.cronExpression);
  const [timezone, setTimezone] = useState(resolvedDraft.timezone);
  const timezoneOptions = useMemo(
    () => createTimezoneOptions(existingSchedule?.timezone ?? null),
    [existingSchedule?.timezone],
  );
  const scheduleBehaviorDescription = resolveSnapshotRefreshScheduleBehaviorDescription({
    after: input.previewAfter,
    cronExpression,
    timezone,
  });
  const cronExpressionBreakdown = resolveCronExpressionBreakdown(cronExpression);
  const submitIsDisabled = input.disabled || (!scheduleEnabled && existingSchedule === null);
  const formId = "sandbox-profile-snapshot-refresh-schedule-form";
  const scheduleStatusMessage = resolveScheduleStatusMessage({
    existingSchedule,
    savedMaintenanceScriptHasContent,
    scheduleEnabled,
  });
  useEffect(() => {
    setScheduleEnabled(existingSchedule !== null || hasInitialDraft);
    setIsEditingSchedule(hasInitialDraft);
    setCronExpression(resolvedDraft.cronExpression);
    setTimezone(resolvedDraft.timezone);
  }, [existingSchedule, hasInitialDraft, resolvedDraft.cronExpression, resolvedDraft.timezone]);

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (scheduleEnabled && isEditingSchedule) {
      const nextCronExpression = cronExpression.trim();
      const nextTimezone = timezone.trim();

      input.onSaveSchedule({
        cronExpression: nextCronExpression,
        maintenanceScript:
          input.maintenanceScriptDraft.trim().length === 0 ? null : input.maintenanceScriptDraft,
        timezone: nextTimezone,
      });
      return;
    }

    if (scheduleEnabled && input.maintenanceScriptHasChanges && existingSchedule !== null) {
      input.onSaveSchedule({
        cronExpression: existingSchedule.cronExpression,
        maintenanceScript:
          input.maintenanceScriptDraft.trim().length === 0 ? null : input.maintenanceScriptDraft,
        timezone: existingSchedule.timezone,
      });
      return;
    }

    if (existingSchedule !== null) {
      input.onDeleteSchedule();
    }
  }

  function handleEditSchedule(): void {
    setScheduleEnabled(existingSchedule !== null || hasInitialDraft);
    setIsEditingSchedule(true);
  }

  function handleCancelScheduleEdit(): void {
    const persistedDraft = resolveSnapshotRefreshScheduleDraft({
      existingSchedule,
      initialDraft: undefined,
    });

    setScheduleEnabled(existingSchedule !== null);
    setIsEditingSchedule(false);
    setCronExpression(persistedDraft.cronExpression);
    setTimezone(persistedDraft.timezone);
    input.onChangeMaintenanceScript(input.savedMaintenanceScript);
  }

  return (
    <SectionBlock
      action={
        <ButtonGroup>
          {!isEditingSchedule ? (
            <Button
              disabled={input.disabled}
              key="edit-snapshot-refresh"
              onClick={handleEditSchedule}
              type="button"
            >
              Edit
            </Button>
          ) : (
            <>
              <Button
                disabled={input.disabled}
                key="cancel-snapshot-refresh"
                onClick={handleCancelScheduleEdit}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={submitIsDisabled}
                form={formId}
                key="save-snapshot-refresh"
                type="submit"
              >
                Save
              </Button>
            </>
          )}
        </ButtonGroup>
      }
      description={scheduleStatusMessage}
      title="Automatic snapshot refresh"
    >
      <form id={formId} onSubmit={handleSubmit}>
        <div className="flex flex-col gap-4">
          {input.mutationError === null ? null : (
            <Notice title="Schedule update failed" variant="alert">
              {input.mutationError}
            </Notice>
          )}
          {input.pendingExternalMaintenanceScript ? (
            <Notice
              action={
                <ButtonGroup>
                  <Button onClick={input.onApplyPendingExternalMaintenanceScript} type="button">
                    Apply assistant version
                  </Button>
                  <Button
                    onClick={input.onDismissPendingExternalMaintenanceScript}
                    type="button"
                    variant="outline"
                  >
                    Keep editing
                  </Button>
                </ButtonGroup>
              }
              title="Maintenance script updated"
              variant="warning"
            >
              The Setup Assistant saved a newer maintenance script while you have unsaved edits.
            </Notice>
          ) : null}

          {!isEditingSchedule ? (
            <SandboxProfileSectionCard>
              <DefinitionList
                itemClassName="[&:has(#snapshot-refresh-maintenance-script-label)]:md:col-span-2"
                items={[
                  {
                    id: "snapshot-refresh-enabled",
                    label: "Refresh enabled",
                    value: existingSchedule === null ? "No" : "Yes",
                  },
                  ...(existingSchedule === null
                    ? []
                    : [
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
                          value:
                            existingSchedule.nextScheduledAt === null
                              ? "Not scheduled"
                              : formatSnapshotRefreshNextScheduledAt({
                                  nextScheduledAt: existingSchedule.nextScheduledAt,
                                  timezone: existingSchedule.timezone,
                                }),
                        },
                        {
                          id: "snapshot-refresh-maintenance-script",
                          label: (
                            <span id="snapshot-refresh-maintenance-script-label">
                              Snapshot maintenance script
                            </span>
                          ),
                          value: (
                            <SnapshotMaintenanceScriptSummaryValue
                              script={input.savedMaintenanceScript}
                            />
                          ),
                        },
                      ]),
                ]}
              />
            </SandboxProfileSectionCard>
          ) : (
            <SandboxProfileSectionCard>
              <div className="flex flex-col">
                <div className="flex min-h-10 items-center justify-between gap-3">
                  <FieldLabel htmlFor="sandbox-profile-snapshot-refresh-enabled">
                    Refresh enabled
                  </FieldLabel>
                  <Switch
                    checked={scheduleEnabled}
                    disabled={input.disabled}
                    id="sandbox-profile-snapshot-refresh-enabled"
                    onCheckedChange={(checked) => {
                      setScheduleEnabled(checked);
                      if (checked) {
                        setIsEditingSchedule(true);
                      }
                    }}
                  />
                </div>

                {scheduleEnabled ? (
                  <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
                    {input.maintenanceScriptHasChanges ? (
                      <p className="text-sm text-muted-foreground">
                        Save the maintenance script to use it for snapshot refresh.
                      </p>
                    ) : null}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldHeader>
                          <FieldLabel htmlFor="sandbox-profile-snapshot-refresh-cron">
                            Cron expression
                          </FieldLabel>
                        </FieldHeader>
                        <FieldContent>
                          <Input
                            disabled={input.disabled}
                            id="sandbox-profile-snapshot-refresh-cron"
                            onChange={(event) => {
                              setCronExpression(event.target.value);
                            }}
                            placeholder={DefaultSnapshotRefreshCronExpression}
                            required
                            value={cronExpression}
                          />
                        </FieldContent>
                      </Field>
                      <Field>
                        <FieldHeader>
                          <FieldLabel htmlFor="sandbox-profile-snapshot-refresh-timezone">
                            Timezone
                          </FieldLabel>
                        </FieldHeader>
                        <FieldContent>
                          <SingleSelectStringComboboxField
                            contentClassName="max-h-80"
                            disabled={input.disabled}
                            emptyMessage="No matching timezones."
                            inputId="sandbox-profile-snapshot-refresh-timezone"
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

                    <CronExpressionBreakdownList
                      breakdown={cronExpressionBreakdown}
                      message={scheduleBehaviorDescription}
                    />

                    <div className="pt-2">
                      <SandboxProfileScriptEditorField
                        ariaLabelledBy="sandbox-profile-maintenance-script-label"
                        description="Runs from the current usable snapshot when refreshing through the snapshot maintenance path."
                        disabled={input.disabled}
                        fieldLabel="Snapshot maintenance script"
                        onChange={input.onChangeMaintenanceScript}
                        placeholderText="#!/usr/bin/env bash"
                        setupAssistant={{
                          disabled: input.setupAssistantControl.disabled,
                          isStarting: input.setupAssistantControl.isStarting,
                          onClick: () => {
                            input.setupAssistantControl.onToggle();
                          },
                          title: input.setupAssistantControl.title,
                        }}
                        testButtonProps={input.testButtonProps}
                        testPanel={input.testPanel}
                        value={input.maintenanceScriptDraft}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </SandboxProfileSectionCard>
          )}
        </div>
      </form>
    </SectionBlock>
  );
}

function resolveScheduleStatusMessage(input: {
  existingSchedule: SnapshotRefreshSchedule;
  savedMaintenanceScriptHasContent: boolean;
  scheduleEnabled: boolean;
}): ReactNode {
  if (!input.scheduleEnabled) {
    return input.existingSchedule === null
      ? "Snapshots will not refresh automatically."
      : "Automatic snapshot refresh will stop after changes are saved.";
  }

  if (input.existingSchedule === null) {
    return "Automatic snapshot refresh will start after a schedule is saved.";
  }

  if (input.savedMaintenanceScriptHasContent) {
    return (
      <>
        Snapshot refresh will build from the current snapshot with{" "}
        <ScriptTermEmphasis>maintenance script</ScriptTermEmphasis>.
      </>
    );
  }

  return (
    <>
      Snapshot refresh will build from the base image with{" "}
      <ScriptTermEmphasis>setup script</ScriptTermEmphasis>.
    </>
  );
}

function CronExpressionBreakdownList(input: {
  breakdown: CronExpressionBreakdown | null;
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

function readBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
}

function PublishSuccessSnapshotNotice(input: {
  noticeKey: Key;
  onDismiss: () => void;
  visible: boolean;
}): React.JSX.Element | null {
  const [presentedNoticeKey, setPresentedNoticeKey] = useState<Key | null>(
    input.visible ? input.noticeKey : null,
  );

  useEffect(() => {
    if (input.visible) {
      setPresentedNoticeKey(input.noticeKey);
      return;
    }

    setPresentedNoticeKey(null);
  }, [input.noticeKey, input.visible]);

  if (presentedNoticeKey === null) {
    return null;
  }

  return (
    <Notice
      autoHideAfterMs={NoticeAutoHideDurationsMs.MEDIUM}
      dismissible
      onDismiss={input.onDismiss}
      resetKey={presentedNoticeKey}
      title="Publish successful, creating a snapshot"
      variant="success"
    />
  );
}
