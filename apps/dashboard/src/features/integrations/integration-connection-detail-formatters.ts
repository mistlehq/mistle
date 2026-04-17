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

export function formatWebhookSourceStatusLabel(status: "active" | "error" | "disabled"): string {
  if (status === "active") {
    return "Active";
  }
  if (status === "error") {
    return "Error";
  }
  return "Disabled";
}

export function formatSyncStateLabel(
  syncState: "never-synced" | "syncing" | "ready" | "error",
): string {
  if (syncState === "never-synced") {
    return "Not synced";
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
  lastSyncedAt?: string;
  syncState: "never-synced" | "syncing" | "ready";
}): string {
  if (input.syncState === "syncing") {
    if (input.lastSyncedAt !== undefined) {
      return `Synced ${formatDateTime(input.lastSyncedAt)}`;
    }
    return "Not synced yet";
  }

  if (input.syncState === "never-synced") {
    return "Not synced yet";
  }

  if (input.lastSyncedAt === undefined) {
    return "Resources are ready.";
  }

  return `Synced ${formatDateTime(input.lastSyncedAt)}`;
}

export function formatResourceLabel(kind: string): string {
  const words = kind
    .split(/[_-]+/g)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`);
  const [firstWord, ...remainingWords] = words;

  if (firstWord === undefined) {
    return "Resource";
  }

  const singularFirstWord = firstWord.endsWith("ies")
    ? `${firstWord.slice(0, -3)}y`
    : firstWord.endsWith("s")
      ? firstWord.slice(0, -1)
      : firstWord;

  return [singularFirstWord, ...remainingWords].join(" ");
}
