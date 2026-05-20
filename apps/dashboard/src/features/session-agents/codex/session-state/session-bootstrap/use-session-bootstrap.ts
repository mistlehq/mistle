import type { ComposerCapability } from "@mistle/integrations-core";
import type {
  CodexExperimentalFeatureSummary,
  CodexJsonRpcClient,
  CodexModelSummary,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { resolveCodexComposerCapabilities } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import {
  readComposerConfigSnapshot,
  type ComposerConfigSnapshot,
} from "../../../../pages/session-composer/session-composer-config.js";
import { StaleConnectionAttemptError } from "../session-connection/codex-session-errors.js";
import { resolveSessionBootstrapState } from "./session-bootstrap-state.js";
import {
  resolveSessionBootstrapPlan,
  type BootstrapConnectionContext,
} from "./session-bootstrap-strategy.js";

export type SessionBootstrapPhase =
  | { status: "unavailable" }
  | { status: "bootstrapping" }
  | { status: "ready" }
  | { status: "failed"; message: string };

export type SessionBootstrapResult = {
  phase: SessionBootstrapPhase;
  composerCapabilities: readonly ComposerCapability[];
  establishedSnapshot: {
    availableModels: readonly CodexModelSummary[];
    configSnapshot: ComposerConfigSnapshot;
  };
};

const EmptyComposerConfig: ComposerConfigSnapshot = {
  model: null,
  modelReasoningEffort: null,
};
const EmptyModels: readonly CodexModelSummary[] = [];
const EmptyFeatures: readonly CodexExperimentalFeatureSummary[] = [];

export function ensureCurrentThreadSyncGeneration(input: {
  currentGeneration: number;
  expectedGeneration: number;
}): void {
  if (input.currentGeneration !== input.expectedGeneration) {
    throw new StaleConnectionAttemptError();
  }
}

type LoadModelsResult = {
  models: readonly CodexModelSummary[];
  response: unknown;
};

type ReadConfigResult = {
  config: unknown;
  response: unknown;
};

type ListFeaturesResult = {
  features: readonly CodexExperimentalFeatureSummary[];
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

function createFeaturesQueryKey(
  connectionKey: string,
  threadId: string,
): readonly ["codex-session-bootstrap", "features", string, string] {
  return ["codex-session-bootstrap", "features", connectionKey, threadId];
}

function featureIsEnabled(input: {
  features: readonly CodexExperimentalFeatureSummary[];
  name: string;
}): boolean {
  return input.features.some((feature) => feature.name === input.name && feature.enabled === true);
}

export function useSessionBootstrap(input: {
  bootstrapConnectionContext: BootstrapConnectionContext | null;
  hydrateInitialThread: (input?: {
    generation?: number;
    ensureCurrentGeneration?: (generation: number) => void;
    rpcClient?: CodexJsonRpcClient;
    threadId?: string | null;
  }) => Promise<"empty" | "hydrated">;
  loadModelsAsync: () => Promise<{ models: readonly CodexModelSummary[]; response: unknown }>;
  readConfigAsync: (includeLayers: boolean) => Promise<{ config: unknown; response: unknown }>;
  listFeaturesAsync: (input: { threadId: string }) => Promise<{
    features: readonly CodexExperimentalFeatureSummary[];
    response: unknown;
  }>;
  rpcClientRef: RefObject<CodexJsonRpcClient | null>;
}) {
  const queryClient = useQueryClient();
  const [establishedConnectionKey, setEstablishedConnectionKey] = useState<string | null>(null);
  const [threadSyncState, setThreadSyncState] = useState<ThreadSyncState>({
    status: "idle",
    threadSyncKey: null,
  });
  const threadSyncGenerationRef = useRef(0);

  const bootstrapPlan = resolveSessionBootstrapPlan({
    bootstrapConnectionContext: input.bootstrapConnectionContext,
    establishedConnectionKey,
  });

  const activeConnectionKey = bootstrapPlan.connectionKey;
  const shouldLoadBootstrapData = bootstrapPlan.shouldLoadBootstrapData;
  const activeThreadSyncKey = bootstrapPlan.threadSyncKey;
  const activeThreadId = input.bootstrapConnectionContext?.activeThreadId ?? null;

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

  const featuresQuery = useQuery<ListFeaturesResult>({
    queryKey:
      activeConnectionKey === null || activeThreadId === null
        ? ["codex-session-bootstrap", "features", "disconnected"]
        : createFeaturesQueryKey(activeConnectionKey, activeThreadId),
    queryFn: async () => {
      if (activeThreadId === null) {
        throw new Error("Choose a Codex thread before listing experimental features.");
      }

      return await input.listFeaturesAsync({ threadId: activeThreadId });
    },
    enabled: activeConnectionKey !== null && activeThreadId !== null,
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
          ensureCurrentGeneration: (generation) => {
            ensureCurrentThreadSyncGeneration({
              currentGeneration: threadSyncGenerationRef.current,
              expectedGeneration: generation,
            });
          },
          ...(input.rpcClientRef.current === null ? {} : { rpcClient: input.rpcClientRef.current }),
          threadId: activeThreadId,
        });
      } catch (error) {
        if (error instanceof StaleConnectionAttemptError) {
          return;
        }

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
  }, [activeThreadId, activeThreadSyncKey, input.hydrateInitialThread, input.rpcClientRef]);

  const establishedModels = useMemo(() => {
    if (establishedConnectionKey === null) {
      return EmptyModels;
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

  const establishedFeatures = useMemo(() => {
    if (establishedConnectionKey === null || activeThreadId === null) {
      return EmptyFeatures;
    }

    return (
      queryClient.getQueryData<ListFeaturesResult>(
        createFeaturesQueryKey(establishedConnectionKey, activeThreadId),
      )?.features ?? []
    );
  }, [activeThreadId, establishedConnectionKey, queryClient]);

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

  const features = useMemo(() => {
    return featuresQuery.data?.features ?? establishedFeatures;
  }, [establishedFeatures, featuresQuery.data?.features]);

  const composerCapabilities = useMemo(
    () =>
      resolveCodexComposerCapabilities({
        goalsEnabled: featureIsEnabled({
          features,
          name: "goals",
        }),
      }),
    [features],
  );

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
      (shouldLoadBootstrapData && (modelsQuery.isPending || configQuery.isPending)) ||
      featuresQuery.isPending);

  const state = useMemo(
    (): SessionBootstrapPhase =>
      resolveSessionBootstrapState({
        activeConnectionKey,
        activeThreadSyncKey,
        bootstrapDataError:
          configQuery.isError && configQuery.error instanceof Error
            ? configQuery.error
            : featuresQuery.isError && featuresQuery.error instanceof Error
              ? featuresQuery.error
              : null,
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
      featuresQuery.error,
      featuresQuery.isError,
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
    phase: state,
    composerCapabilities,
    establishedSnapshot: {
      availableModels,
      configSnapshot,
    },
  } satisfies SessionBootstrapResult;
}
