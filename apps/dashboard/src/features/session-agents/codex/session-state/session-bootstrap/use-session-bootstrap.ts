import type {
  CodexJsonRpcClient,
  CodexModelSummary,
} from "@mistle/integrations-definitions/openai/agent/client";
import { useEffect, useRef, useState, type MutableRefObject } from "react";

import {
  readComposerConfigSnapshot,
  type ComposerConfigSnapshot,
} from "../../../../pages/session-composer/session-composer-config.js";
import {
  buildModelSelectionRequiredMessage,
  buildUnavailableModelErrorMessage,
  resolveActiveComposerModel,
} from "../../../../pages/session-composer/session-composer-model-readiness.js";
import type { ConnectedCodexSession } from "../codex-session-types.js";
import { resolveSessionBootstrapStrategy } from "./session-bootstrap-strategy.js";

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
  const [state, setState] = useState<SessionBootstrapState>({ status: "disconnected" });
  const [configSnapshot, setConfigSnapshot] = useState<ComposerConfigSnapshot>(EmptyComposerConfig);
  const [availableModels, setAvailableModels] = useState<readonly CodexModelSummary[]>([]);
  const [hasEstablishedBaseline, setHasEstablishedBaseline] = useState(false);
  const [establishedSandboxInstanceId, setEstablishedSandboxInstanceId] = useState<string | null>(
    null,
  );
  const bootstrapGenerationRef = useRef(0);

  useEffect(() => {
    const bootstrapStrategy = resolveSessionBootstrapStrategy({
      connectedSession: input.connectedSession,
      establishedSandboxInstanceId,
      hasEstablishedBaseline,
    });

    if (bootstrapStrategy === "disconnected") {
      bootstrapGenerationRef.current += 1;
      if (!hasEstablishedBaseline) {
        setState((currentState) =>
          currentState.status === "disconnected" ? currentState : { status: "disconnected" },
        );
      }
      return;
    }

    const connectedSession = input.connectedSession;
    if (connectedSession === null || connectedSession.threadId === null) {
      return;
    }

    const connectedThreadId = connectedSession.threadId;
    const currentBootstrapGeneration = bootstrapGenerationRef.current + 1;
    bootstrapGenerationRef.current = currentBootstrapGeneration;
    if (bootstrapStrategy === "thread_sync") {
      void (async () => {
        try {
          await input.hydrateInitialThread({
            generation: currentBootstrapGeneration,
            ensureCurrentGeneration: input.ensureCurrentGeneration,
            ...(input.rpcClientRef.current === null
              ? {}
              : { rpcClient: input.rpcClientRef.current }),
            threadId: connectedThreadId,
          });
        } catch (error) {
          if (bootstrapGenerationRef.current !== currentBootstrapGeneration) {
            return;
          }

          setState({
            status: "failed",
            message: error instanceof Error ? error.message : "Could not read thread.",
          });
          return;
        }

        if (bootstrapGenerationRef.current !== currentBootstrapGeneration) {
          return;
        }

        setState({ status: "ready" });
      })();
      return;
    }

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

      setHasEstablishedBaseline(true);
      setEstablishedSandboxInstanceId(connectedSession.sandboxInstanceId);
      setState({ status: "ready" });
    })();
  }, [
    establishedSandboxInstanceId,
    hasEstablishedBaseline,
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
  } satisfies SessionBootstrapResult;
}
