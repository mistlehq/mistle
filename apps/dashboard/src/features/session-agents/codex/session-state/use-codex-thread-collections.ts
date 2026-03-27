import {
  listCodexThreads,
  listLoadedCodexThreads,
  type CodexJsonRpcClient,
  type CodexThreadSummary,
} from "@mistle/integrations-definitions/openai/agent/client";
import { useCallback, useState, type MutableRefObject } from "react";

type RefreshInput = {
  rpcClient?: CodexJsonRpcClient;
  generation?: number;
};

export function useCodexThreadCollections(input: {
  rpcClientRef: MutableRefObject<CodexJsonRpcClient | null>;
  ensureCurrentGeneration: (generation: number) => void;
}) {
  const [availableThreads, setAvailableThreads] = useState<readonly CodexThreadSummary[]>([]);
  const [archivedThreads, setArchivedThreads] = useState<readonly CodexThreadSummary[]>([]);
  const [loadedThreadIds, setLoadedThreadIds] = useState<readonly string[]>([]);

  const refreshThreadList = useCallback(
    async (refreshInput?: RefreshInput): Promise<readonly CodexThreadSummary[]> => {
      const rpcClient = refreshInput?.rpcClient ?? input.rpcClientRef.current;
      if (rpcClient === null) {
        return [];
      }

      const threadList = await listCodexThreads({
        rpcClient,
        limit: 20,
      });
      if (refreshInput?.generation !== undefined) {
        input.ensureCurrentGeneration(refreshInput.generation);
      }

      setAvailableThreads(threadList.threads);
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

  const refreshThreadCollections = useCallback(
    async (refreshInput?: RefreshInput) => {
      const [availableThreadsResult, archivedThreadsResult, loadedThreadIdsResult] =
        await Promise.all([
          refreshThreadList(refreshInput),
          refreshArchivedThreadList(refreshInput),
          refreshLoadedThreadList(refreshInput),
        ]);

      return {
        availableThreads: availableThreadsResult,
        archivedThreads: archivedThreadsResult,
        loadedThreadIds: loadedThreadIdsResult,
      };
    },
    [refreshArchivedThreadList, refreshLoadedThreadList, refreshThreadList],
  );

  const resetThreadCollections = useCallback((): void => {
    setAvailableThreads([]);
    setArchivedThreads([]);
    setLoadedThreadIds([]);
  }, []);

  return {
    availableThreads,
    archivedThreads,
    loadedThreadIds,
    refreshThreadList,
    refreshArchivedThreadList,
    refreshLoadedThreadList,
    refreshThreadCollections,
    resetThreadCollections,
  };
}
