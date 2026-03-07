import type { CodexThreadSummary } from "@mistle/codex-app-server-client";

function resolveThreadRecency(thread: CodexThreadSummary): number {
  if (thread.updatedAt !== null) {
    return thread.updatedAt;
  }

  if (thread.createdAt !== null) {
    return thread.createdAt;
  }

  return Number.NEGATIVE_INFINITY;
}

function compareThreadRecency(left: CodexThreadSummary, right: CodexThreadSummary): number {
  const recencyDifference = resolveThreadRecency(right) - resolveThreadRecency(left);
  if (recencyDifference !== 0) {
    return recencyDifference;
  }

  return left.id.localeCompare(right.id);
}

export function selectPreferredThreadId(input: {
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
}): string | null {
  const availableThreadsById = new Map(input.availableThreads.map((thread) => [thread.id, thread]));
  const loadedAvailableThreads = input.loadedThreadIds.flatMap((threadId) => {
    const thread = availableThreadsById.get(threadId);
    return thread === undefined ? [] : [thread];
  });

  if (loadedAvailableThreads.length > 0) {
    const mostRecentLoadedThread = [...loadedAvailableThreads].sort(compareThreadRecency)[0];
    if (mostRecentLoadedThread === undefined) {
      throw new Error("Loaded thread selection requires at least one thread.");
    }

    return mostRecentLoadedThread.id;
  }

  if (input.loadedThreadIds.length > 0) {
    return input.loadedThreadIds[0] ?? null;
  }

  if (input.availableThreads.length === 0) {
    return null;
  }

  const mostRecentThread = [...input.availableThreads].sort(compareThreadRecency)[0];
  if (mostRecentThread === undefined) {
    throw new Error("Available thread selection requires at least one thread.");
  }

  return mostRecentThread.id;
}
