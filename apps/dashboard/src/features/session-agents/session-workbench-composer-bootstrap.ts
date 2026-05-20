import { useEffect, useMemo } from "react";

import {
  useLocalSessionComposerConfigControl,
  usePersistedSessionComposerConfigControl,
  type SessionComposerConfigControl,
  type SessionComposerConfigWriter,
} from "../pages/session-composer/index.js";
import type { UseCodexSessionStateResult } from "./codex/session-state/index.js";
import {
  buildOpenCodeComposerConfigResetKey,
  buildRefreshingOpenCodeComposerBootstrap,
  type UseOpenCodeSessionStateResult,
} from "./opencode/session-state/index.js";
import type { UsePiSessionStateResult } from "./pi/session-state/index.js";
import { usePiSessionComposerConfigControl } from "./pi/session-state/pi-workbench-composer.js";

export function useCodexWorkbenchComposerState(input: {
  sessionState: UseCodexSessionStateResult;
}): {
  configControl: SessionComposerConfigControl;
} {
  const codexConfig = input.sessionState.codexConfig;
  const sessionMessage = input.sessionState.sessionMessage;

  const configWriter = useMemo<SessionComposerConfigWriter>(
    () => ({
      isUpdating: codexConfig.isBatchWritingConfig || codexConfig.isWritingConfigValue,
      writeModel: (model: string): void => {
        codexConfig.batchWriteConfig({
          edits: [
            {
              keyPath: "model",
              value: model,
              mergeStrategy: "replace",
            },
          ],
        });
      },
      writeReasoningEffort: (reasoningEffort: string): void => {
        codexConfig.writeConfigValue({
          keyPath: "model_reasoning_effort",
          value: reasoningEffort,
          mergeStrategy: "replace",
        });
      },
    }),
    [
      codexConfig.batchWriteConfig,
      codexConfig.isBatchWritingConfig,
      codexConfig.isWritingConfigValue,
      codexConfig.writeConfigValue,
    ],
  );

  const configControl = usePersistedSessionComposerConfigControl({
    bootstrap: input.sessionState.bootstrap,
    clearSessionErrorMessage: sessionMessage.clearSessionErrorMessage,
    writer: configWriter,
  });

  return {
    configControl,
  };
}

export function useOpenCodeWorkbenchComposerState(input: {
  enabled: boolean;
  sandboxInstanceId: string | null;
  selectedRepositoryPath: string | null;
  sessionState: UseOpenCodeSessionStateResult;
}): {
  bootstrap: UseOpenCodeSessionStateResult["bootstrap"];
  configControl: SessionComposerConfigControl;
} {
  const refreshModelCatalog = input.sessionState.lifecycle.refreshModelCatalog;
  const refreshPromptCommands = input.sessionState.lifecycle.refreshPromptCommands;
  const sessionConnectionState = input.sessionState.lifecycle.sessionConnectionState;
  const reportSessionErrorMessage = input.sessionState.sessionMessage.reportSessionErrorMessage;

  useEffect(() => {
    if (!input.enabled || sessionConnectionState !== "connected") {
      return;
    }

    void Promise.all([
      refreshModelCatalog({
        directory: input.selectedRepositoryPath,
      }),
      refreshPromptCommands({
        directory: input.selectedRepositoryPath,
      }),
    ]).catch((error: unknown) => {
      reportSessionErrorMessage(
        error instanceof Error ? error.message : "Could not refresh OpenCode composer data.",
      );
    });
  }, [
    input.enabled,
    refreshModelCatalog,
    refreshPromptCommands,
    reportSessionErrorMessage,
    sessionConnectionState,
    input.selectedRepositoryPath,
  ]);

  const bootstrap = useMemo(() => {
    if (
      sessionConnectionState === "connected" &&
      (input.sessionState.modelCatalogDirectory !== input.selectedRepositoryPath ||
        input.sessionState.commandCatalogDirectory !== input.selectedRepositoryPath)
    ) {
      return buildRefreshingOpenCodeComposerBootstrap();
    }

    return input.sessionState.bootstrap;
  }, [
    input.sessionState.bootstrap,
    input.sessionState.commandCatalogDirectory,
    input.sessionState.modelCatalogDirectory,
    sessionConnectionState,
    input.selectedRepositoryPath,
  ]);

  const configControl = useLocalSessionComposerConfigControl({
    bootstrap,
    clearSessionErrorMessage: input.sessionState.sessionMessage.clearSessionErrorMessage,
    resetKey: buildOpenCodeComposerConfigResetKey(
      input.sandboxInstanceId,
      input.sessionState.lifecycle.sessionSnapshot?.activeSessionId ?? null,
    ),
  });

  return {
    bootstrap,
    configControl,
  };
}

export function usePiWorkbenchComposerState(input: { sessionState: UsePiSessionStateResult }): {
  bootstrap: UsePiSessionStateResult["bootstrap"];
  configControl: SessionComposerConfigControl;
} {
  const bootstrap = input.sessionState.bootstrap;
  const modelWriter = useMemo(
    () => ({
      setModel: input.sessionState.modelControl.setActiveModel,
      setThinkingLevel: input.sessionState.modelControl.setThinkingLevel,
    }),
    [
      input.sessionState.modelControl.setActiveModel,
      input.sessionState.modelControl.setThinkingLevel,
    ],
  );
  const configControl = usePiSessionComposerConfigControl({
    bootstrap,
    clearSessionErrorMessage: input.sessionState.sessionMessage.clearSessionErrorMessage,
    isTurnRunning: input.sessionState.chat.chatState.status === "busy",
    reportSessionErrorMessage: input.sessionState.sessionMessage.reportSessionErrorMessage,
    writer: modelWriter,
  });

  return {
    bootstrap,
    configControl,
  };
}
