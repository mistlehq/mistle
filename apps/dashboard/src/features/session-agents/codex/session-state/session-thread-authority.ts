import type { CodexThreadSummary } from "@mistle/integrations-definitions/openai/agent/client";

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
  activeThreadId: string | null;
  turnCount: number | null;
}): CodexCliLaunchTarget {
  if (input.activeThreadId === null) {
    return {
      type: "start_new",
      shouldClearPersistedThreadId: false,
    };
  }

  if (input.turnCount !== null && isCodexThreadResumable({ turnCount: input.turnCount })) {
    return {
      type: "resume",
      threadId: input.activeThreadId,
    };
  }

  return {
    type: "start_new",
    shouldClearPersistedThreadId: true,
  };
}

export function resolvePostCliPreferredThreadId(input: {
  providerThreadId: string | null;
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
}): string | null {
  if (input.providerThreadId !== null) {
    return input.providerThreadId;
  }

  const availableThreadsById = new Map(input.availableThreads.map((thread) => [thread.id, thread]));
  const loadedAvailableThreads = input.loadedThreadIds.flatMap((threadId) => {
    const thread = availableThreadsById.get(threadId);
    return thread === undefined ? [] : [thread];
  });

  const newestLoadedThread = [...loadedAvailableThreads].sort(compareNewestThreadFirst)[0];
  if (newestLoadedThread !== undefined) {
    return newestLoadedThread.id;
  }

  if (input.loadedThreadIds.length > 0) {
    return input.loadedThreadIds[input.loadedThreadIds.length - 1] ?? null;
  }

  const newestAvailableThread = [...input.availableThreads].sort(compareNewestThreadFirst)[0];
  return newestAvailableThread?.id ?? null;
}

function resolveThreadUpdatedAt(thread: CodexThreadSummary): number {
  return thread.updatedAt ?? thread.createdAt ?? Number.NEGATIVE_INFINITY;
}

function compareNewestThreadFirst(left: CodexThreadSummary, right: CodexThreadSummary): number {
  const updatedDifference = resolveThreadUpdatedAt(right) - resolveThreadUpdatedAt(left);
  if (updatedDifference !== 0) {
    return updatedDifference;
  }

  return right.id.localeCompare(left.id);
}
