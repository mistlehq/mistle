import { formatDateTime } from "../shared/date-formatters.js";

export function formatResourceSummaryCount(count: number): string {
  if (count === 1) {
    return "1 resource summary";
  }

  return `${count} resource summaries`;
}

export function formatConnectionStatusLabel(status: "active" | "error" | "revoked"): string {
  if (status === "active") {
    return "Active";
  }
  if (status === "error") {
    return "Error";
  }
  return "Revoked";
}

export function formatSelectionModeLabel(selectionMode: "single" | "multi"): string {
  if (selectionMode === "single") {
    return "single-select";
  }
  return "multi-select";
}

export function formatSyncStateLabel(
  syncState: "never-synced" | "syncing" | "ready" | "error",
): string {
  if (syncState === "never-synced") {
    return "Never synced";
  }
  if (syncState === "syncing") {
    return "Syncing";
  }
  if (syncState === "error") {
    return "Sync failed";
  }
  return "Ready";
}

export function formatResourceMetadata(input: {
  lastErrorMessage?: string;
  lastSyncedAt?: string;
  syncState: "never-synced" | "syncing" | "ready" | "error";
}): string {
  if (input.syncState === "error") {
    if (input.lastErrorMessage !== undefined) {
      return input.lastErrorMessage;
    }
    return "The last sync attempt failed.";
  }

  if (input.syncState === "syncing") {
    if (input.lastSyncedAt !== undefined) {
      return `Refresh in progress. Last completed sync ${formatDateTime(input.lastSyncedAt)}.`;
    }
    return "Refresh in progress.";
  }

  if (input.syncState === "never-synced") {
    return "Resources have not been synced yet.";
  }

  if (input.lastSyncedAt === undefined) {
    return "Resources are ready.";
  }

  return `Last synced ${formatDateTime(input.lastSyncedAt)}.`;
}
