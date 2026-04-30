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
  putSandboxProfileVersionRefreshSchedule,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import { ActivityStatus } from "../shared/activity-status.js";
import { FormPageSection } from "../shared/form-page.js";
import {
  createTimezoneOptions,
  formatCronExpressionBreakdownDiagram,
  resolveCronExpressionBreakdown,
  resolveSnapshotRefreshScheduleBehaviorDescription,
  type CronExpressionBreakdown,
} from "./sandbox-profile-editor-page-model.js";
import { SandboxProfileEditorHorizontalTabContent } from "./sandbox-profile-editor-sections.js";

export type SnapshotPanelState =
  | {
      kind: "draft-unavailable";
    }
  | {
      kind: "no-snapshot";
    }
  | {
      kind: "creating";
    }
  | {
      kind: "ready";
      latestSnapshotCreatedAt: string | null;
    }
  | {
      kind: "snapshot-error";
      message: string;
    }
  | {
      kind: "refresh-error";
      latestSnapshotCreatedAt: string | null;
      message: string;
    };

export type SnapshotRefreshSchedule = SandboxProfileVersion["refreshSchedule"];
export type SnapshotRefreshScheduleInput = {
  cronExpression: string;
  timezone: string;
};

export function resolveSnapshotPanelState(
  version: SandboxProfileVersion | null,
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
    };
  }

  if (latestSnapshotJob?.state === "failed") {
    const message = latestSnapshotJob.errorMessage ?? "Snapshot materialization failed.";
    return version.usable
      ? {
          kind: "refresh-error",
          latestSnapshotCreatedAt: null,
          message,
        }
      : {
          kind: "snapshot-error",
          message,
        };
  }

  if (!version.usable) {
    return {
      kind: "no-snapshot",
    };
  }

  return {
    kind: "ready",
    latestSnapshotCreatedAt:
      latestSnapshotJob?.state === "succeeded" ? latestSnapshotJob.finishedAt : null,
  };
}

export function shouldShowMissingSnapshotAlert(snapshotState: SnapshotPanelState): boolean {
  return snapshotState.kind === "no-snapshot";
}

export function SandboxProfileSnapshotPanel(input: {
  isActionPending: boolean;
  invalidateProfileVersions: (profileId: string) => Promise<void>;
  onPublishSuccessMessageDismiss: () => void;
  onRefreshSnapshot: () => void;
  publishSuccessMessageKey: Key;
  publishSuccessMessage: boolean;
  profileId: string;
  refreshSchedule: SnapshotRefreshSchedule;
  state: SnapshotPanelState;
  version: number | null;
}): React.JSX.Element {
  return (
    <SandboxProfileSnapshotPanelView
      isActionPending={input.isActionPending}
      onPublishSuccessMessageDismiss={input.onPublishSuccessMessageDismiss}
      onRefreshSnapshot={input.onRefreshSnapshot}
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
  onPublishSuccessMessageDismiss: () => void;
  onRefreshSnapshot: () => void;
  publishSuccessMessageKey: Key;
  publishSuccessMessage: boolean;
  refreshScheduleSection: ReactNode;
  state: SnapshotPanelState;
  version: number | null;
}): React.JSX.Element {
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

  const actionLabel = resolveSnapshotActionLabel(input.state);
  const activityLabel = resolveSnapshotActivityLabel(input.state);
  const latestSnapshotCreatedAt = resolveLatestSnapshotCreatedAt(input.state);

  return (
    <SandboxProfileEditorHorizontalTabContent>
      <SnapshotPanelDescription />

      <PublishSuccessSnapshotNotice
        onDismiss={input.onPublishSuccessMessageDismiss}
        noticeKey={input.publishSuccessMessageKey}
        visible={input.publishSuccessMessage}
      />

      {input.state.kind === "no-snapshot" ? (
        <Notice title="Create a snapshot to start sessions from this profile." variant="alert" />
      ) : null}

      {input.state.kind === "snapshot-error" ? (
        <Notice title="Snapshot failed" variant="alert">
          {input.state.message}
        </Notice>
      ) : null}

      {input.state.kind === "refresh-error" ? (
        <Notice title="Refresh failed" variant="alert">
          {input.state.message}
        </Notice>
      ) : null}

      <FormPageSection>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <DefinitionList
              className="min-w-0 flex-1 md:grid-cols-1"
              items={[
                {
                  id: "snapshot-created",
                  label: "Latest snapshot",
                  value: latestSnapshotCreatedAt ?? "N/A",
                },
              ]}
            />

            {activityLabel === null ? null : (
              <ActivityStatus
                className="shrink-0 justify-start text-muted-foreground sm:min-w-48 sm:justify-end"
                label={activityLabel}
                labelClassName="min-w-0 text-right"
                labelKey={input.state.kind}
              />
            )}

            {activityLabel !== null || actionLabel === null ? null : (
              <Button
                className="w-fit shrink-0"
                disabled={input.isActionPending}
                onClick={input.onRefreshSnapshot}
                type="button"
              >
                {actionLabel}
              </Button>
            )}
          </div>
        </div>
      </FormPageSection>

      {input.refreshScheduleSection}
    </SandboxProfileEditorHorizontalTabContent>
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
                  value: existingSchedule.nextScheduledAt ?? "Not scheduled",
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

function resolveSnapshotActionLabel(state: SnapshotPanelState): string | null {
  if (state.kind === "no-snapshot" || state.kind === "snapshot-error") {
    return "Create snapshot";
  }

  if (state.kind === "ready" || state.kind === "refresh-error") {
    return "Refresh snapshot";
  }

  return null;
}

function resolveSnapshotActivityLabel(state: SnapshotPanelState): string | null {
  if (state.kind === "creating") {
    return "Creating snapshot";
  }

  return null;
}

function resolveLatestSnapshotCreatedAt(state: SnapshotPanelState): string | null {
  if (state.kind === "ready" || state.kind === "refresh-error") {
    return state.latestSnapshotCreatedAt;
  }

  return null;
}
