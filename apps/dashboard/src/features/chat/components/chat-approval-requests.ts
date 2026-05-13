import type {
  CommandApprovalRequestEntry,
  FileChangeApprovalRequestEntry,
  ServerRequestEntry,
} from "../../session-agents/server-requests/index.js";

export function findCommandApprovalRequest(
  requests: readonly ServerRequestEntry[],
  itemId: string,
): CommandApprovalRequestEntry | null {
  const request = requests.find(
    (entry): entry is CommandApprovalRequestEntry =>
      entry.kind === "command-approval" && entry.itemId === itemId,
  );

  return request ?? null;
}

export function findFileChangeApprovalRequest(
  requests: readonly ServerRequestEntry[],
  itemId: string,
): FileChangeApprovalRequestEntry | null {
  const request = requests.find(
    (entry): entry is FileChangeApprovalRequestEntry =>
      entry.kind === "file-change-approval" && entry.itemId === itemId,
  );

  return request ?? null;
}
