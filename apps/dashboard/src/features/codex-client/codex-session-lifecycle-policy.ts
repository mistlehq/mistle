import type {
  CodexSessionConnectionState,
  CodexThreadSummary,
} from "@mistle/codex-app-server-client";

import { selectPreferredThreadId } from "../sessions/thread-selection.js";

export type CodexConnectionThreadStrategy =
  | {
      type: "resume";
      threadId: string;
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
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
}): CodexConnectionThreadStrategy {
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
