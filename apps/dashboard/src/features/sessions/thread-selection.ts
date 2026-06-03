import {
  isCodexSubagentThread,
  type CodexThreadSummary,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";

export type ThreadSelectionPolicy = "oldest" | "most_recently_updated";

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

function resolveThreadUpdatedAt(thread: CodexThreadSummary): number {
  return thread.updatedAt ?? thread.createdAt ?? Number.NEGATIVE_INFINITY;
}

function compareNewestThreadActivity(left: CodexThreadSummary, right: CodexThreadSummary): number {
  const updatedDifference = resolveThreadUpdatedAt(right) - resolveThreadUpdatedAt(left);
  if (updatedDifference !== 0) {
    return updatedDifference;
  }

  return right.id.localeCompare(left.id);
}

function collectLoadedAvailableThreads(input: {
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
}): readonly CodexThreadSummary[] {
  const availableThreadsById = new Map(input.availableThreads.map((thread) => [thread.id, thread]));

  return input.loadedThreadIds.flatMap((threadId) => {
    const thread = availableThreadsById.get(threadId);
    return thread === undefined ? [] : [thread];
  });
}

function collectLoadedThreadIdsWithoutAvailableDetails(input: {
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
}): readonly string[] {
  const availableThreadIds = new Set(input.availableThreads.map((thread) => thread.id));
  return input.loadedThreadIds.filter((threadId) => !availableThreadIds.has(threadId));
}

function collectRootThreads(threads: readonly CodexThreadSummary[]): readonly CodexThreadSummary[] {
  return threads.filter((thread) => !isCodexSubagentThread(thread));
}

export function selectPreferredThreadId(input: {
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
  selectionPolicy?: ThreadSelectionPolicy;
}): string | null {
  const selectionPolicy = input.selectionPolicy ?? "oldest";
  const compareThread =
    selectionPolicy === "most_recently_updated"
      ? compareNewestThreadActivity
      : compareThreadCreation;
  const loadedAvailableThreads = collectRootThreads(collectLoadedAvailableThreads(input));

  if (loadedAvailableThreads.length > 0) {
    const selectedLoadedThread = [...loadedAvailableThreads].sort(compareThread)[0];
    if (selectedLoadedThread === undefined) {
      throw new Error("Loaded thread selection requires at least one thread.");
    }

    return selectedLoadedThread.id;
  }

  const availableRootThreads = collectRootThreads(input.availableThreads);
  const loadedThreadIdsWithoutAvailableDetails =
    collectLoadedThreadIdsWithoutAvailableDetails(input);

  const selectedLoadedThreadIdWithoutAvailableDetails =
    loadedThreadIdsWithoutAvailableDetails.at(0);
  if (selectedLoadedThreadIdWithoutAvailableDetails !== undefined) {
    return selectedLoadedThreadIdWithoutAvailableDetails;
  }

  if (availableRootThreads.length > 0) {
    const selectedAvailableThread = [...availableRootThreads].sort(compareThread)[0];
    if (selectedAvailableThread === undefined) {
      throw new Error("Available thread selection requires at least one thread.");
    }

    return selectedAvailableThread.id;
  }

  return null;
}
