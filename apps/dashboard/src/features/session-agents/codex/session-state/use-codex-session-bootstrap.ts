import type {
  CodexJsonRpcClient,
  CodexModelSummary,
} from "@mistle/integrations-definitions/openai/agent/client";
import { useEffect, useRef, useState, type MutableRefObject } from "react";

import {
  readComposerConfigSnapshot,
  type ComposerConfigSnapshot,
} from "../../../pages/session-composer-config.js";
import {
  buildModelSelectionRequiredMessage,
  buildUnavailableModelErrorMessage,
  resolveActiveComposerModel,
} from "../../../pages/session-composer-model-readiness.js";
import type { ConnectedCodexSession } from "./codex-session-types.js";

export type SessionBootstrapState =
  | { status: "disconnected" }
  | { status: "bootstrapping" }
  | { status: "ready" }
  | { status: "failed"; message: string };

export type CodexSessionBootstrapState = {
  availableModels: readonly CodexModelSummary[];
  configSnapshot: ComposerConfigSnapshot;
  state: SessionBootstrapState;
};

const EmptyComposerConfig: ComposerConfigSnapshot = {
  model: null,
  modelReasoningEffort: null,
};

export function useCodexSessionBootstrap(input: {
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
  const [state, setState] = useState<SessionBootstrapState>({ status: "disconnected" });
  const [configSnapshot, setConfigSnapshot] = useState<ComposerConfigSnapshot>(EmptyComposerConfig);
  const [availableModels, setAvailableModels] = useState<readonly CodexModelSummary[]>([]);
  const bootstrapGenerationRef = useRef(0);

  useEffect(() => {
    if (input.connectedSession === null || input.connectedSession.threadId === null) {
      bootstrapGenerationRef.current += 1;
      setState((currentState) =>
        currentState.status === "disconnected" ? currentState : { status: "disconnected" },
      );
      setConfigSnapshot((currentConfig) =>
        currentConfig.model === null && currentConfig.modelReasoningEffort === null
          ? currentConfig
          : EmptyComposerConfig,
      );
      setAvailableModels((currentModels) => (currentModels.length === 0 ? currentModels : []));
      return;
    }

    const connectedThreadId = input.connectedSession.threadId;
    const currentBootstrapGeneration = bootstrapGenerationRef.current + 1;
    bootstrapGenerationRef.current = currentBootstrapGeneration;
    setState({ status: "bootstrapping" });

    void (async () => {
      const [modelsResult, configResult, threadResult] = await Promise.allSettled([
        input.loadModelsAsync(),
        input.readConfigAsync(false),
        input.hydrateInitialThread({
          generation: currentBootstrapGeneration,
          ensureCurrentGeneration: input.ensureCurrentGeneration,
          ...(input.rpcClientRef.current === null ? {} : { rpcClient: input.rpcClientRef.current }),
          threadId: connectedThreadId,
        }),
      ]);

      if (bootstrapGenerationRef.current !== currentBootstrapGeneration) {
        return;
      }

      if (modelsResult.status === "rejected") {
        setState({
          status: "failed",
          message:
            modelsResult.reason instanceof Error
              ? modelsResult.reason.message
              : "Could not load models.",
        });
        return;
      }

      if (threadResult.status === "rejected") {
        setState({
          status: "failed",
          message:
            threadResult.reason instanceof Error
              ? threadResult.reason.message
              : "Could not read thread.",
        });
        return;
      }

      const nextConfigSnapshot =
        configResult.status === "fulfilled"
          ? readComposerConfigSnapshot(JSON.stringify(configResult.value.config))
          : EmptyComposerConfig;

      const resolvedComposerModel = resolveActiveComposerModel({
        availableModels: modelsResult.value.models,
        selectedModel: nextConfigSnapshot.model,
      });

      setAvailableModels(modelsResult.value.models);
      setConfigSnapshot(nextConfigSnapshot);

      if (resolvedComposerModel === null) {
        setState({
          status: "failed",
          message:
            nextConfigSnapshot.model === null
              ? buildModelSelectionRequiredMessage()
              : buildUnavailableModelErrorMessage(nextConfigSnapshot.model),
        });
        return;
      }

      setState({ status: "ready" });
    })();
  }, [
    input.connectedSession,
    input.ensureCurrentGeneration,
    input.hydrateInitialThread,
    input.loadModelsAsync,
    input.readConfigAsync,
    input.rpcClientRef,
  ]);

  return {
    availableModels,
    configSnapshot,
    state,
  } satisfies CodexSessionBootstrapState;
}
