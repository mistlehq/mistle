import { findNextScheduleOccurrence, validateScheduleCronExpression } from "@mistle/time";

import type { StringComboboxOption } from "../forms/string-combobox-options.js";
import type {
  PublishSandboxProfileVersionResult,
  SandboxProfile,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import type { SandboxProfileBindingEditorRow } from "./sandbox-profile-binding-config-editor.js";

export type SandboxProfileRouteView = "published" | "draft";

export type SandboxProfileEditorVersionMode =
  | {
      kind: "draft";
      version: number;
      activeVersion: number | null;
      hasDraft: true;
    }
  | {
      kind: "active";
      version: number;
      activeVersion: number | null;
      hasDraft: boolean;
      draftVersion: number | null;
    };

type ResolveEditorVersionModeResult =
  | {
      ok: true;
      mode: SandboxProfileEditorVersionMode;
    }
  | {
      ok: false;
      message: string;
    };

const SnapshotRefreshSchedulePreviewPrompt =
  "Enter a valid cron expression and timezone to preview the schedule.";
const BrowserTimezoneOptions = Intl.supportedValuesOf("timeZone").map((timezone) => ({
  label: timezone,
  value: timezone,
}));
const MonthFieldLabels = new Map([
  ["1", "January"],
  ["2", "February"],
  ["3", "March"],
  ["4", "April"],
  ["5", "May"],
  ["6", "June"],
  ["7", "July"],
  ["8", "August"],
  ["9", "September"],
  ["10", "October"],
  ["11", "November"],
  ["12", "December"],
  ["JAN", "January"],
  ["FEB", "February"],
  ["MAR", "March"],
  ["APR", "April"],
  ["MAY", "May"],
  ["JUN", "June"],
  ["JUL", "July"],
  ["AUG", "August"],
  ["SEP", "September"],
  ["OCT", "October"],
  ["NOV", "November"],
  ["DEC", "December"],
]);
const DayOfWeekFieldLabels = new Map([
  ["0", "Sunday"],
  ["1", "Monday"],
  ["2", "Tuesday"],
  ["3", "Wednesday"],
  ["4", "Thursday"],
  ["5", "Friday"],
  ["6", "Saturday"],
  ["7", "Sunday"],
  ["SUN", "Sunday"],
  ["MON", "Monday"],
  ["TUE", "Tuesday"],
  ["WED", "Wednesday"],
  ["THU", "Thursday"],
  ["FRI", "Friday"],
  ["SAT", "Saturday"],
]);

export function resolveSandboxProfileEditorVersionMode(input: {
  activeVersion: number | null;
  versions: readonly SandboxProfileVersion[];
  view: SandboxProfileRouteView;
}): ResolveEditorVersionModeResult {
  const draftVersions = input.versions.filter((version) => version.state === "draft");
  const publishedVersions = input.versions.filter((version) => version.state === "published");
  if (draftVersions.length > 1) {
    return {
      ok: false,
      message: "Sandbox profile has multiple draft versions.",
    };
  }

  const draftVersion = draftVersions[0] ?? null;
  const activeVersion =
    input.activeVersion === null
      ? null
      : (input.versions.find((version) => version.version === input.activeVersion) ?? null);
  const latestPublishedVersion =
    publishedVersions.length === 0
      ? null
      : publishedVersions.reduce((latestVersion, currentVersion) =>
          currentVersion.version > latestVersion.version ? currentVersion : latestVersion,
        );

  if (input.activeVersion !== null && activeVersion === null) {
    return {
      ok: false,
      message: "Sandbox profile active version could not be loaded.",
    };
  }

  if (input.view === "draft") {
    if (draftVersion === null) {
      return {
        ok: false,
        message: "Sandbox profile draft version could not be loaded.",
      };
    }

    return {
      ok: true,
      mode: {
        kind: "draft",
        version: draftVersion.version,
        activeVersion: input.activeVersion,
        hasDraft: true,
      },
    };
  }

  if (latestPublishedVersion !== null) {
    return {
      ok: true,
      mode: {
        kind: "active",
        version: latestPublishedVersion.version,
        activeVersion: input.activeVersion,
        hasDraft: draftVersion !== null,
        draftVersion: draftVersion?.version ?? null,
      },
    };
  }

  return {
    ok: false,
    message: "Sandbox profile published version could not be loaded.",
  };
}

export function shouldPollSandboxProfileSnapshotJobs(
  versions: readonly SandboxProfileVersion[] | undefined,
): boolean {
  if (versions === undefined) {
    return false;
  }

  return versions.some(
    (version) =>
      version.state === "published" &&
      (version.latestSnapshotJob?.state === "queued" ||
        version.latestSnapshotJob?.state === "running"),
  );
}

export function shouldRedirectDraftSandboxProfileViewToPublished(input: {
  versions: readonly SandboxProfileVersion[];
}): boolean {
  const hasDraftVersion = input.versions.some((version) => version.state === "draft");
  const hasPublishedVersion = input.versions.some((version) => version.state === "published");

  return !hasDraftVersion && hasPublishedVersion;
}

export function applyPublishedSandboxProfileVersionToProfile(input: {
  profile: SandboxProfile | undefined;
  result: PublishSandboxProfileVersionResult;
}): SandboxProfile | undefined {
  if (input.profile === undefined) {
    return undefined;
  }

  return {
    ...input.profile,
    activeVersion: input.result.activeVersion,
  };
}

export function applyPublishedSandboxProfileVersionToVersions(input: {
  versions: readonly SandboxProfileVersion[] | undefined;
  result: PublishSandboxProfileVersionResult;
}): readonly SandboxProfileVersion[] | undefined {
  if (input.versions === undefined) {
    return undefined;
  }

  const remainingVersions = input.versions.filter(
    (version) => version.version !== input.result.version.version,
  );
  return [...remainingVersions, input.result.version].sort(
    (left, right) => left.version - right.version,
  );
}

export function resolveSandboxProfileSetupScriptIntegrationRows(
  initialRows: readonly SandboxProfileBindingEditorRow[] | null,
  draftRows: readonly SandboxProfileBindingEditorRow[] | null | undefined,
): readonly SandboxProfileBindingEditorRow[] | null {
  return draftRows ?? initialRows;
}

export type CronExpressionBreakdown = Readonly<{
  minute: string;
  hour: string;
  dayOfMonthExpression: string;
  dayOfMonth: string;
  monthExpression: string;
  month: string;
  dayOfWeekExpression: string;
  dayOfWeek: string;
}>;

export function createTimezoneOptions(
  persistedTimezone: string | null,
): readonly StringComboboxOption[] {
  if (
    persistedTimezone === null ||
    persistedTimezone.trim().length === 0 ||
    BrowserTimezoneOptions.some((option) => option.value === persistedTimezone)
  ) {
    return BrowserTimezoneOptions;
  }

  return [
    {
      label: persistedTimezone,
      value: persistedTimezone,
    },
    ...BrowserTimezoneOptions,
  ];
}

export function resolveCronExpressionBreakdown(
  cronExpression: string,
): CronExpressionBreakdown | null {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }

  try {
    validateScheduleCronExpression(cronExpression);
  } catch {
    return null;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (
    minute === undefined ||
    hour === undefined ||
    dayOfMonth === undefined ||
    month === undefined ||
    dayOfWeek === undefined
  ) {
    return null;
  }

  return {
    minute,
    hour,
    dayOfMonthExpression: dayOfMonth,
    dayOfMonth: describeCronField({
      everyLabel: "Every day",
      field: dayOfMonth,
      labelMap: null,
    }),
    monthExpression: month,
    month: describeCronField({
      everyLabel: "Every month",
      field: month,
      labelMap: MonthFieldLabels,
    }),
    dayOfWeekExpression: dayOfWeek,
    dayOfWeek: describeCronField({
      everyLabel: "Every day",
      field: dayOfWeek,
      labelMap: DayOfWeekFieldLabels,
    }),
  };
}

function describeCronField(input: {
  everyLabel: string;
  field: string;
  labelMap: ReadonlyMap<string, string> | null;
}): string {
  if (input.field === "*") {
    return input.everyLabel;
  }

  const parts = input.field.split(",");
  const labels = parts.map((part) => describeCronFieldPart({ part, labelMap: input.labelMap }));
  if (labels.length === 1) {
    const label = labels[0];
    if (label === undefined) {
      throw new Error("Cron field part did not produce a label.");
    }
    return label;
  }

  return labels.join(", ");
}

function describeCronFieldPart(input: {
  part: string;
  labelMap: ReadonlyMap<string, string> | null;
}): string {
  if (input.part.includes("-")) {
    const [start, end] = input.part.split("-");
    if (start !== undefined && end !== undefined) {
      return `${describeCronFieldPart({ part: start, labelMap: input.labelMap })}-${describeCronFieldPart(
        {
          part: end,
          labelMap: input.labelMap,
        },
      )}`;
    }
  }

  const mappedLabel = input.labelMap?.get(input.part.toUpperCase());
  if (mappedLabel !== undefined) {
    return mappedLabel;
  }

  return input.part;
}

export function formatCronExpressionBreakdownDiagram(input: CronExpressionBreakdown): string {
  return [
    `${input.minute} ${input.hour} ${input.dayOfMonthExpression} ${input.monthExpression} ${input.dayOfWeekExpression}`,
    "| | | | |",
    `| | | | day of week: ${input.dayOfWeek}`,
    `| | | month: ${input.month.toLowerCase()}`,
    `| | day of month: ${input.dayOfMonth.toLowerCase()}`,
    `| hour: ${formatHourLabel(input.hour)}`,
    `minute: ${formatMinuteLabel(input.minute)}`,
  ].join("\n");
}

function formatMinuteLabel(minute: string): string {
  if (minute === "*") {
    return "every minute";
  }

  if (minute.startsWith("*/")) {
    const interval = minute.slice(2);
    return `every ${interval} minutes`;
  }

  return `at minute ${minute}`;
}

function formatHourLabel(hour: string): string {
  if (hour === "*") {
    return "every hour";
  }

  const hourNumber = Number(hour);
  if (!Number.isInteger(hourNumber) || hourNumber < 0 || hourNumber > 23) {
    return hour;
  }

  if (hourNumber === 0) {
    return "12 AM";
  }

  if (hourNumber < 12) {
    return `${hourNumber} AM`;
  }

  if (hourNumber === 12) {
    return "12 PM";
  }

  return `${hourNumber - 12} PM`;
}

export function resolveSnapshotRefreshScheduleBehaviorDescription(input: {
  after: Date;
  cronExpression: string;
  timezone: string;
}): string {
  const cronExpression = input.cronExpression.trim();
  const timezone = input.timezone.trim();
  if (cronExpression.length === 0 || timezone.length === 0) {
    return SnapshotRefreshSchedulePreviewPrompt;
  }

  try {
    const occurrence = findNextScheduleOccurrence({
      after: input.after,
      cronExpression,
      timezone,
    });

    if (occurrence === null) {
      return "No future refresh is scheduled.";
    }

    return `Next refresh: ${occurrence.localScheduledDate} ${occurrence.localScheduledTime} ${timezone}.`;
  } catch {
    return SnapshotRefreshSchedulePreviewPrompt;
  }
}
