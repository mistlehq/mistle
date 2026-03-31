import type { CodexThreadSummary } from "@mistle/integrations-definitions/openai/agent/client";

import { selectPreferredThreadId } from "../../../sessions/thread-selection.js";

export type CodexCliLaunchTarget =
  | {
      type: "resume";
      threadId: string;
    }
  | {
      type: "start_new";
      shouldClearPersistedThreadId: boolean;
    };

export function isCodexThreadResumable(input: { turnCount: number }): boolean {
  return input.turnCount > 0;
}

export function resolveCodexCliLaunchTarget(input: {
  persistedThreadId: string | null;
  turnCount: number | null;
}): CodexCliLaunchTarget {
  if (input.persistedThreadId === null) {
    return {
      type: "start_new",
      shouldClearPersistedThreadId: false,
    };
  }

  if (input.turnCount !== null && isCodexThreadResumable({ turnCount: input.turnCount })) {
    return {
      type: "resume",
      threadId: input.persistedThreadId,
    };
  }

  return {
    type: "start_new",
    shouldClearPersistedThreadId: true,
  };
}

export function resolvePostCliPreferredThreadId(input: {
  persistedThreadId: string | null;
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
}): string | null {
  if (input.persistedThreadId !== null) {
    return input.persistedThreadId;
  }

  return selectPreferredThreadId({
    availableThreads: input.availableThreads,
    loadedThreadIds: input.loadedThreadIds,
  });
}
