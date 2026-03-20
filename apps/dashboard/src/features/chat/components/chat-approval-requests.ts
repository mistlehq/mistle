import type {
  CodexCommandApprovalRequestEntry,
  CodexFileChangeApprovalRequestEntry,
  CodexApprovalRequestEntry,
} from "../../session-agents/codex/approvals/index.js";

export function findCommandApprovalRequest(
  requests: readonly CodexApprovalRequestEntry[],
  itemId: string,
): CodexCommandApprovalRequestEntry | null {
  const request = requests.find(
    (entry): entry is CodexCommandApprovalRequestEntry =>
      entry.kind === "command-approval" && entry.itemId === itemId,
  );

  return request ?? null;
}

export function findFileChangeApprovalRequest(
  requests: readonly CodexApprovalRequestEntry[],
  itemId: string,
): CodexFileChangeApprovalRequestEntry | null {
  const request = requests.find(
    (entry): entry is CodexFileChangeApprovalRequestEntry =>
      entry.kind === "file-change-approval" && entry.itemId === itemId,
  );

  return request ?? null;
}
