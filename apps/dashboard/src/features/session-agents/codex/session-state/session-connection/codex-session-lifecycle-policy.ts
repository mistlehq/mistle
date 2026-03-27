import type {
  CodexSessionConnectionState,
  CodexThreadSummary,
} from "@mistle/integrations-definitions/openai/agent/client";

import { selectPreferredThreadId } from "../../../../sessions/thread-selection.js";

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
  shouldDisconnectSession: boolean;
  lifecycleErrorMessage: string | null;
} {
  if (input.state === "closed" || input.state === "error") {
    return {
      shouldDisconnectSession: true,
      lifecycleErrorMessage: input.errorMessage ?? "The Codex session connection closed.",
    };
  }

  return {
    shouldDisconnectSession: false,
    lifecycleErrorMessage: null,
  };
}

export function selectCodexConnectionThreadStrategy(input: {
  preferredThreadId: string | null;
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
}): CodexConnectionThreadStrategy {
  if (input.preferredThreadId !== null) {
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
