import type { CodexJsonRpcId } from "@mistle/integrations-definitions/agent-runtimes/codex/client";

import type { CodexApprovalRequestEntry } from "./codex-approval-requests-state.js";

function hasMatchingRequestId(
  entryRequestId: CodexJsonRpcId,
  targetRequestId: CodexJsonRpcId,
): boolean {
  return String(entryRequestId) === String(targetRequestId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUserInputCancelResponse(result: unknown): boolean {
  return isRecord(result) && result["decision"] === "cancel";
}

function createCodexUserInputCancelResponse(): {
  contentItems: readonly [{ text: string; type: "inputText" }];
  success: true;
} {
  return {
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify({
          decision: "cancel",
        }),
      },
    ],
    success: true,
  };
}

export function createCodexServerRequestResponse(input: {
  entries: readonly CodexApprovalRequestEntry[];
  requestId: CodexJsonRpcId;
  result: unknown;
}): unknown {
  const entry = input.entries.find((candidate) =>
    hasMatchingRequestId(candidate.requestId, input.requestId),
  );

  if (entry?.kind === "tool-user-input" && isUserInputCancelResponse(input.result)) {
    return createCodexUserInputCancelResponse();
  }

  return input.result;
}
