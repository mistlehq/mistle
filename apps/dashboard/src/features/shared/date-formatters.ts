import { dateFromEpochMs } from "@mistle/time";

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});
const DEFAULT_RELATIVE_CUTOFF_DAYS = 7;

function parseDate(isoDateTime: string): Date | null {
  const epochMs = Date.parse(isoDateTime);
  if (!Number.isFinite(epochMs)) {
    return null;
  }

  return dateFromEpochMs(epochMs);
}

function parseEpochMs(isoDateTime: string): number | null {
  const epochMs = Date.parse(isoDateTime);
  if (!Number.isFinite(epochMs)) {
    return null;
  }

  return epochMs;
}

function compactRelativeTimeFromMs(deltaMs: number): string {
  const absDeltaMs = Math.abs(deltaMs);

  if (absDeltaMs < 60_000) {
    return "now";
  }

  const minuteDelta = Math.round(deltaMs / 60_000);
  if (Math.abs(minuteDelta) < 60) {
    return RELATIVE_TIME_FORMATTER.format(minuteDelta, "minute")
      .replace(" minutes", " min")
      .replace(" minute", " min");
  }

  const hourDelta = Math.round(deltaMs / 3_600_000);
  if (Math.abs(hourDelta) < 24) {
    return RELATIVE_TIME_FORMATTER.format(hourDelta, "hour")
      .replace(" hours", " hr")
      .replace(" hour", " hr");
  }

  const dayDelta = Math.round(deltaMs / 86_400_000);
  if (Math.abs(dayDelta) < 30) {
    return RELATIVE_TIME_FORMATTER.format(dayDelta, "day");
  }

  const monthDelta = Math.round(deltaMs / 2_592_000_000);
  if (Math.abs(monthDelta) < 12) {
    return RELATIVE_TIME_FORMATTER.format(monthDelta, "month")
      .replace(" months", " mo")
      .replace(" month", " mo");
  }

  const yearDelta = Math.round(deltaMs / 31_536_000_000);
  return RELATIVE_TIME_FORMATTER.format(yearDelta, "year")
    .replace(" years", " yr")
    .replace(" year", " yr");
}

function compactUnitRelativeTimeFromMs(deltaMs: number): string {
  const absDeltaMs = Math.abs(deltaMs);

  if (absDeltaMs < 60_000) {
    return "now";
  }

  const minuteDelta = Math.round(absDeltaMs / 60_000);
  if (minuteDelta < 60) {
    return `${String(minuteDelta)}m`;
  }

  const hourDelta = Math.round(absDeltaMs / 3_600_000);
  if (hourDelta < 24) {
    return `${String(hourDelta)}h`;
  }

  const dayDelta = Math.round(absDeltaMs / 86_400_000);
  if (dayDelta < 30) {
    return `${String(dayDelta)}d`;
  }

  const monthDelta = Math.round(absDeltaMs / 2_592_000_000);
  if (monthDelta < 12) {
    return `${String(monthDelta)}mo`;
  }

  const yearDelta = Math.round(absDeltaMs / 31_536_000_000);
  return `${String(yearDelta)}y`;
}

export function formatDate(isoDateTime: string): string {
  const parsedDate = parseDate(isoDateTime);
  if (parsedDate === null) {
    return "Unknown";
  }

  return DATE_FORMATTER.format(parsedDate);
}

export function formatDateTime(isoDateTime: string, timeZone?: string): string {
  const parsedDate = parseDate(isoDateTime);
  if (parsedDate === null) {
    return "Unknown";
  }

  if (timeZone !== undefined) {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(parsedDate);
  }

  return DATE_TIME_FORMATTER.format(parsedDate);
}

export function formatTimeZoneOffset(input: { isoDateTime: string; timeZone: string }): string {
  const parsedDate = parseDate(input.isoDateTime);
  if (parsedDate === null) {
    return "Unknown";
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: input.timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(parsedDate);
  const timeZoneName = parts.find((part) => part.type === "timeZoneName");

  if (timeZoneName === undefined) {
    throw new Error(`Could not format timezone: ${input.timeZone}.`);
  }

  return timeZoneName.value;
}

export function formatRelativeOrDate(
  isoDateTime: string,
  input?: {
    nowEpochMs?: number;
    relativeCutoffDays?: number;
  },
): string {
  const epochMs = parseEpochMs(isoDateTime);
  if (epochMs === null) {
    return "Unknown";
  }

  const nowEpochMs = input?.nowEpochMs ?? Date.now();
  const relativeCutoffDays = input?.relativeCutoffDays ?? DEFAULT_RELATIVE_CUTOFF_DAYS;
  const deltaMs = epochMs - nowEpochMs;
  const relativeCutoffMs = relativeCutoffDays * 86_400_000;

  if (Math.abs(deltaMs) < relativeCutoffMs) {
    return compactRelativeTimeFromMs(deltaMs);
  }

  return formatDate(isoDateTime);
}

export function formatCompactRelativeOrDate(
  isoDateTime: string,
  input?: {
    nowEpochMs?: number;
  },
): string {
  const epochMs = parseEpochMs(isoDateTime);
  if (epochMs === null) {
    return "Unknown";
  }

  const nowEpochMs = input?.nowEpochMs ?? Date.now();
  const deltaMs = epochMs - nowEpochMs;

  return compactUnitRelativeTimeFromMs(deltaMs);
}
