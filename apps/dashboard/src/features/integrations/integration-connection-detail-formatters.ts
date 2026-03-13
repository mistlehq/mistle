import { formatDateTime } from "../shared/date-formatters.js";

export function formatConnectionStatusLabel(status: "active" | "error" | "revoked"): string {
  if (status === "active") {
    return "Active";
  }
  if (status === "error") {
    return "Error";
  }
  return "Revoked";
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
      return `Last synced ${formatDateTime(input.lastSyncedAt)}.`;
    }
    return "Resources have not been synced yet.";
  }

  if (input.syncState === "never-synced") {
    return "Resources have not been synced yet.";
  }

  if (input.lastSyncedAt === undefined) {
    return "Resources are ready.";
  }

  return `Last synced ${formatDateTime(input.lastSyncedAt)}.`;
}

export function formatResourceHeading(input: { count: number; kind: string }): string {
  const words = input.kind
    .split(/[_-]+/g)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`);
  const [firstWord, ...remainingWords] = words;

  if (firstWord === undefined) {
    return `Resources (${input.count})`;
  }

  const singularFirstWord = firstWord.endsWith("ies")
    ? `${firstWord.slice(0, -3)}y`
    : firstWord.endsWith("s")
      ? firstWord.slice(0, -1)
      : firstWord;

  return [`${singularFirstWord}`, ...remainingWords, `Resources (${input.count})`].join(" ");
}

export function formatResourceInlineMetadata(input: {
  lastErrorMessage?: string;
  lastSyncedAt?: string;
  syncState: "never-synced" | "syncing" | "ready" | "error";
}): string {
  if (input.syncState === "error" && input.lastErrorMessage !== undefined) {
    return "The last sync attempt failed.";
  }

  return formatResourceMetadata(input);
}
