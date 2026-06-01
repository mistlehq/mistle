import type {
  CodexSessionConnectionState,
  CodexThreadSummary,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";

import {
  selectPreferredThreadId,
  type ThreadSelectionPolicy,
} from "../../../../sessions/thread-selection.js";

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
  isGatewayServiceRestart: boolean;
  state: CodexSessionConnectionState;
  errorMessage: string | null;
}): {
  shouldDisconnectSession: boolean;
  lifecycleErrorMessage: string | null;
  isGatewayServiceRestart: boolean;
  recoverableDisconnectMessage: string | null;
  recoverableDisconnectStrategy: "reconnect_transport" | null;
} {
  if (input.state === "closed" || input.state === "error") {
    const disconnectMessage = input.isGatewayServiceRestart
      ? "Gateway service is restarting."
      : (input.errorMessage ?? "The Codex session connection closed.");
    return {
      shouldDisconnectSession: true,
      lifecycleErrorMessage: input.hasConnectedSession ? null : disconnectMessage,
      isGatewayServiceRestart: input.isGatewayServiceRestart,
      recoverableDisconnectMessage: input.hasConnectedSession ? disconnectMessage : null,
      recoverableDisconnectStrategy: input.hasConnectedSession ? "reconnect_transport" : null,
    };
  }

  return {
    shouldDisconnectSession: false,
    lifecycleErrorMessage: null,
    isGatewayServiceRestart: false,
    recoverableDisconnectMessage: null,
    recoverableDisconnectStrategy: null,
  };
}

export function selectCodexConnectionThreadStrategy(input: {
  targetThreadId: string | null;
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
  selectionPolicy?: ThreadSelectionPolicy;
}): CodexConnectionThreadStrategy {
  if (input.targetThreadId !== null) {
    return {
      type: "resume",
      threadId: input.targetThreadId,
    };
  }

  const selectedThreadId = selectPreferredThreadId({
    availableThreads: input.availableThreads,
    loadedThreadIds: input.loadedThreadIds,
    ...(input.selectionPolicy === undefined ? {} : { selectionPolicy: input.selectionPolicy }),
  });

  if (selectedThreadId !== null) {
    return {
      type: "resume",
      threadId: selectedThreadId,
    };
  }

  return {
    type: "start_new",
  };
}
