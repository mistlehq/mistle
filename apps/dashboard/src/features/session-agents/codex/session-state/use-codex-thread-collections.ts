import {
  isCodexSubagentThread,
  listCodexThreads,
  listLoadedCodexThreads,
  type CodexJsonRpcClient,
  type CodexThreadSummary,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { useCallback, useRef, useState, type RefObject } from "react";

type RefreshInput = {
  rpcClient?: CodexJsonRpcClient;
  generation?: number;
};

type ThreadCollectionsRefreshInput = RefreshInput & {
  originalThreadId?: string;
};

type OriginalThreadIdSnapshot = {
  generation: number | null;
  threadId: string | null;
};

const OriginalThreadListPageSize = 100;

export function useCodexThreadCollections(input: {
  rpcClientRef: RefObject<CodexJsonRpcClient | null>;
  ensureCurrentGeneration: (generation: number) => void;
}) {
  const [availableThreads, setAvailableThreads] = useState<readonly CodexThreadSummary[]>([]);
  const [hasMoreAvailableThreads, setHasMoreAvailableThreads] = useState(false);
  const [archivedThreads, setArchivedThreads] = useState<readonly CodexThreadSummary[]>([]);
  const [loadedThreadIds, setLoadedThreadIds] = useState<readonly string[]>([]);
  const [originalThreadIdSnapshot, setOriginalThreadIdSnapshot] =
    useState<OriginalThreadIdSnapshot | null>(null);
  const originalThreadIdSnapshotRef = useRef<OriginalThreadIdSnapshot | null>(null);
  const originalThreadId = originalThreadIdSnapshot?.threadId ?? null;

  const updateOriginalThreadIdSnapshot = useCallback(
    (snapshot: OriginalThreadIdSnapshot | null): void => {
      originalThreadIdSnapshotRef.current = snapshot;
      setOriginalThreadIdSnapshot(snapshot);
    },
    [],
  );

  const refreshThreadList = useCallback(
    async (refreshInput?: RefreshInput): Promise<readonly CodexThreadSummary[]> => {
      const rpcClient = refreshInput?.rpcClient ?? input.rpcClientRef.current;
      if (rpcClient === null) {
        return [];
      }

      const threadList = await listCodexThreads({
        rpcClient,
        limit: 20,
        sortKey: "updated_at",
      });
      if (refreshInput?.generation !== undefined) {
        input.ensureCurrentGeneration(refreshInput.generation);
      }

      setAvailableThreads(threadList.threads);
      setHasMoreAvailableThreads(threadList.nextCursor !== null);
      return threadList.threads;
    },
    [input],
  );

  const refreshArchivedThreadList = useCallback(
    async (refreshInput?: RefreshInput): Promise<readonly CodexThreadSummary[]> => {
      const rpcClient = refreshInput?.rpcClient ?? input.rpcClientRef.current;
      if (rpcClient === null) {
        return [];
      }

      const threadList = await listCodexThreads({
        rpcClient,
        limit: 20,
        archived: true,
      });
      if (refreshInput?.generation !== undefined) {
        input.ensureCurrentGeneration(refreshInput.generation);
      }

      setArchivedThreads(threadList.threads);
      return threadList.threads;
    },
    [input],
  );

  const refreshLoadedThreadList = useCallback(
    async (refreshInput?: RefreshInput): Promise<readonly string[]> => {
      const rpcClient = refreshInput?.rpcClient ?? input.rpcClientRef.current;
      if (rpcClient === null) {
        return [];
      }

      const loadedThreads = await listLoadedCodexThreads({
        rpcClient,
      });
      if (refreshInput?.generation !== undefined) {
        input.ensureCurrentGeneration(refreshInput.generation);
      }

      setLoadedThreadIds(loadedThreads.threadIds);
      return loadedThreads.threadIds;
    },
    [input],
  );

  const refreshOriginalThreadId = useCallback(
    async (refreshInput?: RefreshInput): Promise<string | null> => {
      const rpcClient = refreshInput?.rpcClient ?? input.rpcClientRef.current;
      if (rpcClient === null) {
        return null;
      }

      const availableOriginalThreadCandidates = await listOriginalThreadCandidates({
        rpcClient,
        ensureCurrentGeneration: input.ensureCurrentGeneration,
        ...(refreshInput?.generation === undefined ? {} : { generation: refreshInput.generation }),
      });
      const archivedOriginalThreadCandidates = await listOriginalThreadCandidates({
        rpcClient,
        archived: true,
        ensureCurrentGeneration: input.ensureCurrentGeneration,
        ...(refreshInput?.generation === undefined ? {} : { generation: refreshInput.generation }),
      });
      const nextOriginalThreadId = resolveOriginalCodexThreadId([
        ...availableOriginalThreadCandidates,
        ...archivedOriginalThreadCandidates,
      ]);
      updateOriginalThreadIdSnapshot({
        generation: refreshInput?.generation ?? null,
        threadId: nextOriginalThreadId,
      });
      return nextOriginalThreadId;
    },
    [input, updateOriginalThreadIdSnapshot],
  );

  const recordStartedThreadAsOriginalAfterEmptyScan = useCallback(
    (recordInput: { generation: number; threadId: string }): void => {
      const nextSnapshot = resolveOriginalThreadIdSnapshotAfterThreadStart({
        generation: recordInput.generation,
        snapshot: originalThreadIdSnapshotRef.current,
        startedThreadId: recordInput.threadId,
      });
      if (nextSnapshot === originalThreadIdSnapshotRef.current) {
        return;
      }

      updateOriginalThreadIdSnapshot(nextSnapshot);
    },
    [updateOriginalThreadIdSnapshot],
  );

  const refreshThreadCollections = useCallback(
    async (refreshInput?: ThreadCollectionsRefreshInput) => {
      const requestedOriginalThreadId = refreshInput?.originalThreadId;
      const listRefreshInput =
        refreshInput === undefined
          ? undefined
          : {
              ...(refreshInput.rpcClient === undefined
                ? {}
                : { rpcClient: refreshInput.rpcClient }),
              ...(refreshInput.generation === undefined
                ? {}
                : { generation: refreshInput.generation }),
            };
      const reusableOriginalThreadIdSnapshot = resolveReusableOriginalThreadIdSnapshot({
        ...(refreshInput?.generation === undefined
          ? {}
          : { refreshGeneration: refreshInput.generation }),
        snapshot: originalThreadIdSnapshotRef.current,
      });
      let originalThreadIdPromise: Promise<string | null>;
      if (requestedOriginalThreadId !== undefined) {
        updateOriginalThreadIdSnapshot({
          generation: refreshInput?.generation ?? null,
          threadId: requestedOriginalThreadId,
        });
        originalThreadIdPromise = Promise.resolve(requestedOriginalThreadId);
      } else if (reusableOriginalThreadIdSnapshot !== null) {
        originalThreadIdPromise = Promise.resolve(reusableOriginalThreadIdSnapshot.threadId);
      } else {
        originalThreadIdPromise = refreshOriginalThreadId(listRefreshInput);
      }
      const [
        availableThreadsResult,
        archivedThreadsResult,
        loadedThreadIdsResult,
        originalThreadIdResult,
      ] = await Promise.all([
        refreshThreadList(listRefreshInput),
        refreshArchivedThreadList(listRefreshInput),
        refreshLoadedThreadList(listRefreshInput),
        originalThreadIdPromise,
      ]);

      return {
        availableThreads: availableThreadsResult,
        archivedThreads: archivedThreadsResult,
        loadedThreadIds: loadedThreadIdsResult,
        originalThreadId: originalThreadIdResult,
      };
    },
    [
      refreshArchivedThreadList,
      refreshLoadedThreadList,
      refreshOriginalThreadId,
      refreshThreadList,
      updateOriginalThreadIdSnapshot,
    ],
  );

  return {
    availableThreads,
    hasMoreAvailableThreads,
    archivedThreads,
    loadedThreadIds,
    originalThreadId,
    refreshThreadList,
    refreshArchivedThreadList,
    refreshLoadedThreadList,
    recordStartedThreadAsOriginalAfterEmptyScan,
    refreshThreadCollections,
  };
}

export function resolveReusableOriginalThreadIdSnapshot(input: {
  refreshGeneration?: number;
  snapshot: OriginalThreadIdSnapshot | null;
}): OriginalThreadIdSnapshot | null {
  if (input.snapshot === null) {
    return null;
  }

  if (input.snapshot.threadId === null) {
    return null;
  }

  if (
    input.refreshGeneration !== undefined &&
    input.snapshot.generation !== input.refreshGeneration
  ) {
    return null;
  }

  return input.snapshot;
}

export function resolveOriginalCodexThreadId(
  threads: readonly CodexThreadSummary[],
): string | null {
  let originalThreadId: string | null = null;
  let originalCreatedAt: number | null = null;

  for (const thread of threads) {
    if (isCodexSubagentThread(thread)) {
      continue;
    }

    if (thread.createdAt === null) {
      continue;
    }

    if (
      originalCreatedAt === null ||
      thread.createdAt < originalCreatedAt ||
      (thread.createdAt === originalCreatedAt &&
        (originalThreadId === null || thread.id < originalThreadId))
    ) {
      originalThreadId = thread.id;
      originalCreatedAt = thread.createdAt;
    }
  }

  return originalThreadId;
}

export function resolveOriginalThreadIdSnapshotAfterThreadStart(input: {
  generation: number;
  snapshot: OriginalThreadIdSnapshot | null;
  startedThreadId: string;
}): OriginalThreadIdSnapshot | null {
  if (input.snapshot === null) {
    return input.snapshot;
  }

  if (input.snapshot.generation !== input.generation) {
    return input.snapshot;
  }

  if (input.snapshot.threadId !== null) {
    return input.snapshot;
  }

  return {
    generation: input.generation,
    threadId: input.startedThreadId,
  };
}

async function listOriginalThreadCandidates(input: {
  rpcClient: CodexJsonRpcClient;
  archived?: boolean;
  ensureCurrentGeneration: (generation: number) => void;
  generation?: number;
}): Promise<readonly CodexThreadSummary[]> {
  let cursor: string | null = null;
  const threads: CodexThreadSummary[] = [];

  do {
    const threadList = await listCodexThreads({
      rpcClient: input.rpcClient,
      limit: OriginalThreadListPageSize,
      cursor,
      ...(input.archived === undefined ? {} : { archived: input.archived }),
      sortKey: "created_at",
    });
    if (input.generation !== undefined) {
      input.ensureCurrentGeneration(input.generation);
    }

    threads.push(...threadList.threads);
    cursor = threadList.nextCursor;
  } while (cursor !== null);

  return threads;
}
