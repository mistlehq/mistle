import type { SandboxProfileStatus } from "./sandbox-profiles-types.js";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatSandboxProfileStatus(status: SandboxProfileStatus): string {
  if (status === "active") {
    return "Active";
  }

  return "Inactive";
}

export function formatSandboxProfileUpdatedAt(isoDateTime: string): string {
  const epochMs = Date.parse(isoDateTime);
  if (!Number.isFinite(epochMs)) {
    return "Unknown";
  }

  return DATE_TIME_FORMATTER.format(new Date(epochMs));
}
