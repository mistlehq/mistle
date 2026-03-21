import type {
  CodexSessionConnectionState,
  CodexThreadSummary,
} from "@mistle/integrations-definitions/openai/agent/client";

import { selectPreferredThreadId } from "../../../sessions/thread-selection.js";

export type CodexConnectionThreadStrategy =
  | {
      type: "resume";
      threadId: string;
    }
  | {
      type: "error";
      errorMessage: string;
    }
  | {
      type: "start_new";
    };

export function resolveCodexConnectionStateTransition(input: {
  state: CodexSessionConnectionState;
  errorMessage: string | null;
}): {
  shouldResetSession: boolean;
  startErrorMessage: string | null;
} {
  if (input.state === "closed" || input.state === "error") {
    return {
      shouldResetSession: true,
      startErrorMessage: input.errorMessage ?? "The Codex session connection closed.",
    };
  }

  return {
    shouldResetSession: false,
    startErrorMessage: null,
  };
}

export function selectCodexConnectionThreadStrategy(input: {
  preferredThreadId: string | null;
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
}): CodexConnectionThreadStrategy {
  if (input.preferredThreadId !== null) {
    const hasPreferredThread =
      input.loadedThreadIds.includes(input.preferredThreadId) ||
      input.availableThreads.some((thread) => thread.id === input.preferredThreadId);

    if (!hasPreferredThread) {
      return {
        type: "error",
        errorMessage: `This session is linked to persisted Codex thread '${input.preferredThreadId}', but that thread is no longer available.`,
      };
    }

    return {
      type: "resume",
      threadId: input.preferredThreadId,
    };
  }

  const preferredThreadId = selectPreferredThreadId({
    availableThreads: input.availableThreads,
    loadedThreadIds: input.loadedThreadIds,
  });

  if (preferredThreadId !== null) {
    return {
      type: "resume",
      threadId: preferredThreadId,
    };
  }

  return {
    type: "start_new",
  };
}
