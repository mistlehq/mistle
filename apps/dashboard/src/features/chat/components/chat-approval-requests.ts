import type {
  CodexCommandApprovalRequestEntry,
  CodexFileChangeApprovalRequestEntry,
  CodexServerRequestEntry,
} from "../../codex-client/codex-server-requests-state.js";

export function findCommandApprovalRequest(
  requests: readonly CodexServerRequestEntry[],
  itemId: string,
): CodexCommandApprovalRequestEntry | null {
  const request = requests.find(
    (entry): entry is CodexCommandApprovalRequestEntry =>
      entry.kind === "command-approval" && entry.itemId === itemId,
  );

  return request ?? null;
}

export function findFileChangeApprovalRequest(
  requests: readonly CodexServerRequestEntry[],
  itemId: string,
): CodexFileChangeApprovalRequestEntry | null {
  const request = requests.find(
    (entry): entry is CodexFileChangeApprovalRequestEntry =>
      entry.kind === "file-change-approval" && entry.itemId === itemId,
  );

  return request ?? null;
}
