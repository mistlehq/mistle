import {
  BrailleSpinner,
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
  deleteSandboxProfileVersionRefreshSchedule,
  putSandboxProfileVersionMaintenanceScript,
  putSandboxProfileVersionRefreshSchedule,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import { formatDateTime, formatTimeZoneOffset } from "../shared/date-formatters.js";
import { FormPageSection } from "../shared/form-page.js";
import { SandboxOperationProgress } from "./sandbox-operation-progress.js";
import {
  createTimezoneOptions,
  formatCronExpressionBreakdownDiagram,
  resolveCronExpressionBreakdown,
  resolveSnapshotRefreshScheduleBehaviorDescription,
  type CronExpressionBreakdown,
} from "./sandbox-profile-editor-page-model.js";
import { SandboxProfileEditorHorizontalTabContent } from "./sandbox-profile-editor-sections.js";
import {
  SandboxProfileSetupScriptTestButton,
  SandboxProfileSetupScriptTestPanel,
  useSandboxProfileMaintenanceScriptTestRun,
} from "./sandbox-profile-setup-script-test.js";
import { SandboxSetupScriptEditor } from "./sandbox-setup-script-editor.js";

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

export type SnapshotRefreshSchedule = SandboxProfileVersion["refreshSchedule"];
export type SnapshotRefreshScheduleInput = {
  cronExpression: string;
  timezone: string;
};

function formatSnapshotRefreshNextScheduledAt(input: {
  nextScheduledAt: string;
  timezone: string;
}): string {
  return `${formatDateTime(input.nextScheduledAt, input.timezone)} ${formatTimeZoneOffset({
    isoDateTime: input.nextScheduledAt,
    timeZone: input.timezone,
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
      latestSnapshotJob?.state === "succeeded" ? latestSnapshotJob.finishedAt : null,
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
  state: SnapshotPanelState;
  canRunMaintenanceScript: boolean;
  canRunMaintenanceRefresh: boolean;
  version: number | null;
}): React.JSX.Element {
  return (
    <SandboxProfileSnapshotPanelView
      isActionPending={input.isActionPending}
      canRunMaintenanceRefresh={input.canRunMaintenanceRefresh}
      maintenanceScriptSection={
        input.version === null ? null : (
          <SandboxProfileMaintenanceScriptSection
            canRunMaintenanceScript={input.canRunMaintenanceScript}
            disabled={input.isActionPending}
            invalidateProfileVersions={input.invalidateProfileVersions}
            maintenanceScript={input.maintenanceScript}
            profileId={input.profileId}
            version={input.version}
          />
        )
      }
      onMaintenanceRefreshSnapshot={input.onMaintenanceRefreshSnapshot}
      onPublishSuccessMessageDismiss={input.onPublishSuccessMessageDismiss}
      onRefreshSnapshot={input.onRefreshSnapshot}
      onRetryPublishSnapshot={input.onRetryPublishSnapshot}
      publishSuccessMessage={input.publishSuccessMessage}
      publishSuccessMessageKey={input.publishSuccessMessageKey}
      refreshScheduleSection={
        input.version === null ? null : (
          <SandboxProfileSnapshotRefreshScheduleSection
            disabled={input.isActionPending}
            invalidateProfileVersions={input.invalidateProfileVersions}
            profileId={input.profileId}
            refreshSchedule={input.refreshSchedule}
            version={input.version}
          />
        )
      }
      state={input.state}
      version={input.version}
    />
  );
}

export function SandboxProfileSnapshotPanelView(input: {
  isActionPending: boolean;
  canRunMaintenanceRefresh: boolean;
  maintenanceScriptSection: ReactNode;
  onMaintenanceRefreshSnapshot: () => void;
  onPublishSuccessMessageDismiss: () => void;
  onRefreshSnapshot: () => void;
  onRetryPublishSnapshot: () => void;
  publishSuccessMessageKey: Key;
  publishSuccessMessage: boolean;
  refreshScheduleSection: ReactNode;
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
        state={input.state}
        version={input.version}
      />

      {input.maintenanceScriptSection}

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
      <Button
        className="w-fit shrink-0"
        disabled={input.isActionPending}
        onClick={input.onRefreshSnapshot}
        type="button"
      >
        Refresh from setup script
      </Button>
      <Button
        className="w-fit shrink-0"
        disabled={input.isActionPending || !input.canRunMaintenanceRefresh}
        onClick={input.onMaintenanceRefreshSnapshot}
        type="button"
        variant="secondary"
      >
        Run maintenance refresh
      </Button>
    </ButtonGroup>
  );
}

function SnapshotPanelDescription(): React.JSX.Element {
  return (
    <p className="text-sm text-muted-foreground">
      A snapshot is the prepared sandbox image created from this published profile version and its
      setup script. New sessions can only start after a snapshot is ready.
    </p>
  );
}

function formatPublishSnapshotFailureMessage(input: {
  publishedVersion: number;
  runnableVersion: number | null;
}): string {
  const publishedVersion = `v${String(input.publishedVersion)}`;
  if (input.runnableVersion === null) {
    return `Version ${publishedVersion} was published, but its snapshot could not be created. New sessions and triggers cannot use this profile until the snapshot is retried successfully.`;
  }

  return `Version ${publishedVersion} was published, but its snapshot could not be created. New sessions and triggers will continue using v${String(input.runnableVersion)} until the snapshot is retried successfully.`;
}

function resolveSnapshotStatusSummaryDescription(state: SnapshotStatusState): string {
  if (state.kind === "ready" || state.kind === "refresh-error") {
    return `Latest snapshot: ${state.latestSnapshotCreatedAt ?? "N/A"}`;
  }

  const fallbackVersion =
    state.runnableVersion !== null ? `v${String(state.runnableVersion)}` : null;

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
    return `Sandbox Profile v${String(input.version)}'s snapshot is ready`;
  }

  const currentVersion = `v${String(input.state.publishedVersion)}`;
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
  disabled: boolean;
  invalidateProfileVersions: (profileId: string) => Promise<void>;
  profileId: string;
  refreshSchedule: SnapshotRefreshSchedule;
  version: number;
}): React.JSX.Element {
  const [mutationError, setMutationError] = useState<string | null>(null);
  const previousRefreshScheduleRef = useRef(input.refreshSchedule);
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
      });
    },
    onSuccess: async () => {
      setMutationError(null);
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

  return (
    <SandboxProfileSnapshotRefreshScheduleForm
      disabled={input.disabled || isMutating}
      existingSchedule={input.refreshSchedule}
      mutationError={mutationError}
      onDeleteSchedule={() => {
        removeScheduleMutation.mutate();
      }}
      onSaveSchedule={(schedule) => {
        saveScheduleMutation.mutate(schedule);
      }}
      previewAfter={new Date()}
    />
  );
}

function SandboxProfileMaintenanceScriptSection(input: {
  canRunMaintenanceScript: boolean;
  disabled: boolean;
  invalidateProfileVersions: (profileId: string) => Promise<void>;
  maintenanceScript: string | null;
  profileId: string;
  version: number;
}): React.JSX.Element {
  const [draftValue, setDraftValue] = useState(input.maintenanceScript ?? "");
  const [persistedValue, setPersistedValue] = useState(input.maintenanceScript ?? "");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const saveMutation = useMutation({
    mutationFn: async (maintenanceScript: string) =>
      putSandboxProfileVersionMaintenanceScript({
        profileId: input.profileId,
        version: input.version,
        maintenanceScript: maintenanceScript.trim().length === 0 ? null : maintenanceScript,
      }),
    onSuccess: async (result) => {
      const nextValue = result.maintenanceScript ?? "";
      setMutationError(null);
      setDraftValue(nextValue);
      setPersistedValue(nextValue);
      await input.invalidateProfileVersions(input.profileId);
    },
    onError: (error: unknown) => {
      setMutationError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not save maintenance script.",
        }),
      );
    },
  });
  const isMutating = saveMutation.isPending;
  const hasChanges = draftValue !== persistedValue;
  const maintenanceScriptTest = useSandboxProfileMaintenanceScriptTestRun({
    canRun: input.canRunMaintenanceScript,
    disabled: input.disabled || isMutating,
    maintenanceScript: draftValue,
    profileId: input.profileId,
    version: input.version,
  });

  useEffect(() => {
    const nextValue = input.maintenanceScript ?? "";
    setDraftValue(nextValue);
    setPersistedValue(nextValue);
    setMutationError(null);
  }, [input.maintenanceScript]);

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    saveMutation.mutate(draftValue);
  }

  return (
    <FormPageSection>
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-4 p-4">
          <Field>
            <FieldHeader>
              <FieldLabel id="sandbox-profile-maintenance-script-label">
                Maintenance script
              </FieldLabel>
            </FieldHeader>
            <FieldContent>
              <SandboxSetupScriptEditor
                ariaLabelledBy="sandbox-profile-maintenance-script-label"
                disabled={input.disabled || isMutating}
                onChange={setDraftValue}
                placeholderText="#!/usr/bin/env bash"
                value={draftValue}
              />
            </FieldContent>
          </Field>

          {mutationError === null ? null : (
            <Notice title="Maintenance script action failed" variant="alert">
              {mutationError}
            </Notice>
          )}

          <SandboxProfileSetupScriptTestPanel {...maintenanceScriptTest.panelProps} />

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={input.disabled || isMutating || !hasChanges} type="submit">
              Save maintenance script
            </Button>
            <SandboxProfileSetupScriptTestButton {...maintenanceScriptTest.buttonProps} />
          </div>
        </div>
      </form>
    </FormPageSection>
  );
}

export function SandboxProfileSnapshotRefreshScheduleForm(input: {
  disabled: boolean;
  existingSchedule: SnapshotRefreshSchedule;
  initialDraft?: {
    cronExpression: string;
    timezone: string;
  };
  mutationError: string | null;
  onDeleteSchedule: () => void;
  onSaveSchedule: (schedule: SnapshotRefreshScheduleInput) => void;
  previewAfter: Date;
}): React.JSX.Element {
  const existingSchedule = input.existingSchedule;
  const hasInitialDraft = input.initialDraft !== undefined;
  const initialDraftCronExpression = input.initialDraft?.cronExpression;
  const initialDraftTimezone = input.initialDraft?.timezone;
  const [scheduleEnabled, setScheduleEnabled] = useState(
    existingSchedule !== null || hasInitialDraft,
  );
  const [cronExpression, setCronExpression] = useState(
    initialDraftCronExpression ?? existingSchedule?.cronExpression ?? "",
  );
  const [timezone, setTimezone] = useState(
    initialDraftTimezone ?? existingSchedule?.timezone ?? readBrowserTimeZone(),
  );
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
  const scheduleStatusMessage = scheduleEnabled
    ? existingSchedule === null
      ? "Automatic refresh will start after a schedule is saved."
      : "Automatic refresh is enabled for this published version."
    : "Snapshots will not refresh automatically.";

  useEffect(() => {
    setScheduleEnabled(existingSchedule !== null || hasInitialDraft);
    setCronExpression(initialDraftCronExpression ?? existingSchedule?.cronExpression ?? "");
    setTimezone(initialDraftTimezone ?? existingSchedule?.timezone ?? readBrowserTimeZone());
  }, [existingSchedule, hasInitialDraft, initialDraftCronExpression, initialDraftTimezone]);

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (scheduleEnabled) {
      const nextCronExpression = cronExpression.trim();
      const nextTimezone = timezone.trim();

      input.onSaveSchedule({
        cronExpression: nextCronExpression,
        timezone: nextTimezone,
      });
      return;
    }

    if (existingSchedule !== null) {
      input.onDeleteSchedule();
    }
  }

  return (
    <FormPageSection>
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-4 p-4">
          <div className="space-y-1">
            <div className="flex min-h-10 items-center justify-between gap-3">
              <div className="space-y-1">
                <FieldLabel htmlFor="sandbox-profile-snapshot-refresh-enabled">
                  Automatic refresh
                </FieldLabel>
                <p className="text-sm text-muted-foreground">{scheduleStatusMessage}</p>
              </div>
              <Switch
                aria-label="Automatic refresh"
                checked={scheduleEnabled}
                disabled={input.disabled}
                id="sandbox-profile-snapshot-refresh-enabled"
                onCheckedChange={(checked) => {
                  setScheduleEnabled(checked);
                }}
              />
            </div>
          </div>

          {input.mutationError === null ? null : (
            <Notice title="Schedule update failed" variant="alert">
              {input.mutationError}
            </Notice>
          )}

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
                  value:
                    existingSchedule.nextScheduledAt === null
                      ? "Not scheduled"
                      : formatSnapshotRefreshNextScheduledAt({
                          nextScheduledAt: existingSchedule.nextScheduledAt,
                          timezone: existingSchedule.timezone,
                        }),
                },
              ]}
            />
          )}

          {scheduleEnabled ? (
            <>
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
                      placeholder="0 9 * * 1"
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
            </>
          ) : null}

          {scheduleEnabled || existingSchedule !== null ? (
            <ButtonGroup>
              <Button disabled={submitIsDisabled} type="submit">
                {scheduleEnabled ? "Save schedule" : "Save changes"}
              </Button>
            </ButtonGroup>
          ) : null}
        </div>
      </form>
    </FormPageSection>
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
