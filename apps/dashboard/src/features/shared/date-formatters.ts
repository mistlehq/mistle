import { dateFromEpochMs } from "@mistle/time";

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function parseDate(isoDateTime: string): Date | null {
  const epochMs = Date.parse(isoDateTime);
  if (!Number.isFinite(epochMs)) {
    return null;
  }

  return dateFromEpochMs(epochMs);
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
