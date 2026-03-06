import { dateFromEpochMs } from "@mistle/time";

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

export function formatDate(isoDateTime: string): string {
  const epochMs = Date.parse(isoDateTime);
  if (!Number.isFinite(epochMs)) {
    return "Unknown";
  }

  return DATE_FORMATTER.format(dateFromEpochMs(epochMs));
}
