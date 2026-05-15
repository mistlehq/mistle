import { useEffect, useMemo } from "react";

import {
  useLocalSessionComposerConfigControl,
  type SessionComposerConfigControl,
} from "../pages/session-composer/index.js";
import {
  buildOpenCodeComposerConfigResetKey,
  buildRefreshingOpenCodeComposerBootstrap,
  type UseOpenCodeSessionStateResult,
} from "./opencode/session-state/index.js";

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
