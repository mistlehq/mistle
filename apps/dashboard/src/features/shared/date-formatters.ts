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

export function formatDate(isoDateTime: string): string {
  const parsedDate = parseDate(isoDateTime);
  if (parsedDate === null) {
    return "Unknown";
  }

  return DATE_FORMATTER.format(parsedDate);
}

export function formatDateTime(isoDateTime: string): string {
  const parsedDate = parseDate(isoDateTime);
  if (parsedDate === null) {
    return "Unknown";
  }

  return DATE_TIME_FORMATTER.format(parsedDate);
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
