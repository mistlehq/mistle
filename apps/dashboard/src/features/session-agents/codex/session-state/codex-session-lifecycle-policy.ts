import type {
  CodexSessionConnectionState,
  CodexThreadSummary,
} from "@mistle/integrations-definitions/openai/agent/client";

import { selectPreferredThreadId } from "../../../sessions/thread-selection.js";

export type CodexConnectionThreadStrategy =
  | {
      type: "reuse_loaded";
      threadId: string;
    }
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
  const preferredLoadedThreadId = selectPreferredThreadId({
    availableThreads: input.availableThreads,
    loadedThreadIds: input.loadedThreadIds,
  });

  if (preferredLoadedThreadId !== null && input.loadedThreadIds.includes(preferredLoadedThreadId)) {
    return {
      type: "reuse_loaded",
      threadId: preferredLoadedThreadId,
    };
  }

  const preferredThreadId = selectPreferredThreadId({
    availableThreads: input.availableThreads,
    loadedThreadIds: [],
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
