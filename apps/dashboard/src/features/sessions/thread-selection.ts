import type { CodexThreadSummary } from "@mistle/integrations-definitions/openai/agent/client";

function resolveThreadCreatedAt(thread: CodexThreadSummary): number {
  if (thread.createdAt !== null) {
    return thread.createdAt;
  }

  return Number.POSITIVE_INFINITY;
}

function compareThreadCreation(left: CodexThreadSummary, right: CodexThreadSummary): number {
  const creationDifference = resolveThreadCreatedAt(left) - resolveThreadCreatedAt(right);
  if (creationDifference !== 0) {
    return creationDifference;
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
    const oldestLoadedThread = [...loadedAvailableThreads].sort(compareThreadCreation)[0];
    if (oldestLoadedThread === undefined) {
      throw new Error("Loaded thread selection requires at least one thread.");
    }

    return oldestLoadedThread.id;
  }

  if (input.loadedThreadIds.length > 0) {
    return input.loadedThreadIds[0] ?? null;
  }

  if (input.availableThreads.length === 0) {
    return null;
  }

  const oldestThread = [...input.availableThreads].sort(compareThreadCreation)[0];
  if (oldestThread === undefined) {
    throw new Error("Available thread selection requires at least one thread.");
  }

  return oldestThread.id;
}
