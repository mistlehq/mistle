import type {
  CodexSessionConnectionState,
  CodexThreadSummary,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";

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
  hasConnectedSession: boolean;
  state: CodexSessionConnectionState;
  errorMessage: string | null;
}): {
  shouldDisconnectSession: boolean;
  lifecycleErrorMessage: string | null;
  recoverableDisconnectMessage: string | null;
  recoverableDisconnectStrategy: "reconnect_transport" | null;
} {
  if (input.state === "closed" || input.state === "error") {
    const disconnectMessage = input.errorMessage ?? "The Codex session connection closed.";
    return {
      shouldDisconnectSession: true,
      lifecycleErrorMessage: input.hasConnectedSession ? null : disconnectMessage,
      recoverableDisconnectMessage: input.hasConnectedSession ? disconnectMessage : null,
      recoverableDisconnectStrategy: input.hasConnectedSession ? "reconnect_transport" : null,
    };
  }

  return {
    shouldDisconnectSession: false,
    lifecycleErrorMessage: null,
    recoverableDisconnectMessage: null,
    recoverableDisconnectStrategy: null,
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
