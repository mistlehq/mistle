import type {
  CodexJsonRpcClient,
  CodexModelSummary,
} from "@mistle/integrations-definitions/openai/agent/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import {
  readComposerConfigSnapshot,
  type ComposerConfigSnapshot,
} from "../../../../pages/session-composer/session-composer-config.js";
import type { ConnectedCodexSession } from "../codex-session-types.js";
import { resolveSessionBootstrapState } from "./session-bootstrap-state.js";
import { resolveSessionBootstrapPlan } from "./session-bootstrap-strategy.js";

export type SessionBootstrapState =
  | { status: "disconnected" }
  | { status: "bootstrapping" }
  | { status: "ready" }
  | { status: "failed"; message: string };

export type SessionBootstrapResult = {
  availableModels: readonly CodexModelSummary[];
  configSnapshot: ComposerConfigSnapshot;
  state: SessionBootstrapState;
};

const EmptyComposerConfig: ComposerConfigSnapshot = {
  model: null,
  modelReasoningEffort: null,
};

type LoadModelsResult = {
  models: readonly CodexModelSummary[];
  response: unknown;
};

type ReadConfigResult = {
  config: unknown;
  response: unknown;
};

type ThreadSyncState =
  | { status: "idle"; threadSyncKey: null }
  | { status: "syncing"; threadSyncKey: string }
  | { status: "ready"; threadSyncKey: string }
  | { status: "failed"; threadSyncKey: string; message: string };

function createModelsQueryKey(
  connectionKey: string,
): readonly ["codex-session-bootstrap", "models", string] {
  return ["codex-session-bootstrap", "models", connectionKey];
}

function createConfigQueryKey(
  connectionKey: string,
): readonly ["codex-session-bootstrap", "config", string] {
  return ["codex-session-bootstrap", "config", connectionKey];
}

export function useSessionBootstrap(input: {
  connectedSession: ConnectedCodexSession | null;
  ensureCurrentGeneration: (generation: number) => void;
  hydrateInitialThread: (input?: {
    generation?: number;
    ensureCurrentGeneration?: (generation: number) => void;
    rpcClient?: CodexJsonRpcClient;
    threadId?: string | null;
  }) => Promise<"empty" | "hydrated">;
  loadModelsAsync: () => Promise<{ models: readonly CodexModelSummary[]; response: unknown }>;
  readConfigAsync: (includeLayers: boolean) => Promise<{ config: unknown; response: unknown }>;
  rpcClientRef: MutableRefObject<CodexJsonRpcClient | null>;
}) {
  const queryClient = useQueryClient();
  const [establishedConnectionKey, setEstablishedConnectionKey] = useState<string | null>(null);
  const [threadSyncState, setThreadSyncState] = useState<ThreadSyncState>({
    status: "idle",
    threadSyncKey: null,
  });
  const threadSyncGenerationRef = useRef(0);

  const bootstrapPlan = resolveSessionBootstrapPlan({
    connectedSession: input.connectedSession,
    establishedConnectionKey,
  });

  const activeConnectionKey = bootstrapPlan.connectionKey;
  const shouldLoadBootstrapData = bootstrapPlan.shouldLoadBootstrapData;
  const activeThreadSyncKey = bootstrapPlan.threadSyncKey;
  const activeThreadId = input.connectedSession?.threadId ?? null;

  const modelsQuery = useQuery<LoadModelsResult>({
    queryKey:
      activeConnectionKey === null
        ? ["codex-session-bootstrap", "models", "disconnected"]
        : createModelsQueryKey(activeConnectionKey),
    queryFn: async () => {
      return await input.loadModelsAsync();
    },
    enabled: activeConnectionKey !== null && shouldLoadBootstrapData,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });

  const configQuery = useQuery<ReadConfigResult>({
    queryKey:
      activeConnectionKey === null
        ? ["codex-session-bootstrap", "config", "disconnected"]
        : createConfigQueryKey(activeConnectionKey),
    queryFn: async () => {
      return await input.readConfigAsync(false);
    },
    enabled: activeConnectionKey !== null && shouldLoadBootstrapData,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (activeThreadSyncKey === null || activeThreadId === null) {
      return;
    }

    const currentThreadSyncGeneration = threadSyncGenerationRef.current + 1;
    threadSyncGenerationRef.current = currentThreadSyncGeneration;
    setThreadSyncState({
      status: "syncing",
      threadSyncKey: activeThreadSyncKey,
    });

    void (async () => {
      try {
        await input.hydrateInitialThread({
          generation: currentThreadSyncGeneration,
          ensureCurrentGeneration: input.ensureCurrentGeneration,
          ...(input.rpcClientRef.current === null ? {} : { rpcClient: input.rpcClientRef.current }),
          threadId: activeThreadId,
        });
      } catch (error) {
        if (threadSyncGenerationRef.current !== currentThreadSyncGeneration) {
          return;
        }

        setThreadSyncState({
          status: "failed",
          threadSyncKey: activeThreadSyncKey,
          message: error instanceof Error ? error.message : "Could not read thread.",
        });
        return;
      }

      if (threadSyncGenerationRef.current !== currentThreadSyncGeneration) {
        return;
      }

      setThreadSyncState({
        status: "ready",
        threadSyncKey: activeThreadSyncKey,
      });
    })();
  }, [
    activeThreadId,
    activeThreadSyncKey,
    input.ensureCurrentGeneration,
    input.hydrateInitialThread,
    input.rpcClientRef,
  ]);

  const establishedModels = useMemo(() => {
    if (establishedConnectionKey === null) {
      return [] as readonly CodexModelSummary[];
    }

    return (
      queryClient.getQueryData<LoadModelsResult>(createModelsQueryKey(establishedConnectionKey))
        ?.models ?? []
    );
  }, [establishedConnectionKey, queryClient]);

  const establishedConfigSnapshot = useMemo(() => {
    if (establishedConnectionKey === null) {
      return EmptyComposerConfig;
    }

    const cachedConfig = queryClient.getQueryData<ReadConfigResult>(
      createConfigQueryKey(establishedConnectionKey),
    );
    if (cachedConfig === undefined) {
      return EmptyComposerConfig;
    }

    return readComposerConfigSnapshot(JSON.stringify(cachedConfig.config));
  }, [establishedConnectionKey, queryClient]);

  const availableModels = useMemo(() => {
    if (shouldLoadBootstrapData) {
      return modelsQuery.data?.models ?? establishedModels;
    }

    return establishedModels;
  }, [establishedModels, modelsQuery.data?.models, shouldLoadBootstrapData]);

  const configSnapshot = useMemo(() => {
    if (!shouldLoadBootstrapData) {
      return establishedConfigSnapshot;
    }

    if (configQuery.data !== undefined) {
      return readComposerConfigSnapshot(JSON.stringify(configQuery.data.config));
    }

    return establishedConfigSnapshot;
  }, [configQuery.data, establishedConfigSnapshot, shouldLoadBootstrapData]);

  const threadSyncFailedForCurrentThread =
    activeThreadSyncKey !== null &&
    threadSyncState.threadSyncKey === activeThreadSyncKey &&
    threadSyncState.status === "failed";
  const threadSyncReadyForCurrentThread =
    activeThreadSyncKey !== null &&
    threadSyncState.threadSyncKey === activeThreadSyncKey &&
    threadSyncState.status === "ready";
  const isCurrentConnectionBootstrapping =
    activeConnectionKey !== null &&
    activeThreadSyncKey !== null &&
    (!threadSyncReadyForCurrentThread ||
      (shouldLoadBootstrapData && (modelsQuery.isPending || configQuery.isPending)));

  const state = useMemo(
    (): SessionBootstrapState =>
      resolveSessionBootstrapState({
        activeConnectionKey,
        activeThreadSyncKey,
        configError:
          configQuery.isError && configQuery.error instanceof Error ? configQuery.error : null,
        isCurrentConnectionBootstrapping,
        modelsError:
          modelsQuery.isError && modelsQuery.error instanceof Error ? modelsQuery.error : null,
        threadSyncFailureMessage:
          threadSyncFailedForCurrentThread && threadSyncState.status === "failed"
            ? threadSyncState.message
            : null,
      }),
    [
      activeConnectionKey,
      activeThreadSyncKey,
      configQuery.error,
      configQuery.isError,
      isCurrentConnectionBootstrapping,
      modelsQuery.error,
      modelsQuery.isError,
      threadSyncFailedForCurrentThread,
      threadSyncState,
    ],
  );

  useEffect(() => {
    if (state.status !== "ready" || activeConnectionKey === null) {
      return;
    }

    setEstablishedConnectionKey((currentKey) =>
      currentKey === activeConnectionKey ? currentKey : activeConnectionKey,
    );
  }, [activeConnectionKey, state.status]);

  return {
    availableModels,
    configSnapshot,
    state,
  } satisfies SessionBootstrapResult;
}
