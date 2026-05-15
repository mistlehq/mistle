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
  const sessionConnectionState = input.sessionState.lifecycle.sessionConnectionState;
  const reportSessionErrorMessage = input.sessionState.sessionMessage.reportSessionErrorMessage;

  useEffect(() => {
    if (!input.enabled || sessionConnectionState !== "connected") {
      return;
    }

    void refreshModelCatalog({
      directory: input.selectedRepositoryPath,
    }).catch((error: unknown) => {
      reportSessionErrorMessage(
        error instanceof Error ? error.message : "Could not refresh OpenCode model providers.",
      );
    });
  }, [
    input.enabled,
    refreshModelCatalog,
    reportSessionErrorMessage,
    sessionConnectionState,
    input.selectedRepositoryPath,
  ]);

  const bootstrap = useMemo(() => {
    if (
      sessionConnectionState === "connected" &&
      input.sessionState.modelCatalogDirectory !== input.selectedRepositoryPath
    ) {
      return buildRefreshingOpenCodeComposerBootstrap();
    }

    return input.sessionState.bootstrap;
  }, [
    input.sessionState.bootstrap,
    input.sessionState.modelCatalogDirectory,
    sessionConnectionState,
    input.selectedRepositoryPath,
  ]);

  const configControl = useLocalSessionComposerConfigControl({
    bootstrap,
    clearSessionErrorMessage: input.sessionState.sessionMessage.clearSessionErrorMessage,
    canChangeReasoningEffort: false,
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
