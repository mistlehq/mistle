import type { CodexModelSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";

import type { SessionBootstrapPhase } from "../../session-agents/codex/session-state/session-bootstrap/index.js";
import {
  buildModelSelectionRequiredMessage,
  buildNonImageCapableModelWarningMessage,
  buildUnavailableModelErrorMessage,
  supportsImageInspection,
} from "./session-composer-model-readiness.js";

export type ComposerStatusMessage = {
  message: string;
  variant: "alert" | "default";
};

export function resolveComposerBootstrapMessage(input: {
  activeComposerModel: CodexModelSummary | null;
  bootstrapState: SessionBootstrapPhase;
  selectedModel: string | null;
}): string | null {
  if (input.bootstrapState.status === "failed") {
    return input.bootstrapState.message;
  }

  if (input.bootstrapState.status !== "ready") {
    return null;
  }

  if (input.activeComposerModel !== null) {
    return null;
  }

  return input.selectedModel === null
    ? buildModelSelectionRequiredMessage()
    : buildUnavailableModelErrorMessage(input.selectedModel);
}

export function resolveComposerStatusMessage(input: {
  activeComposerModel: CodexModelSummary | null;
  bootstrapState: SessionBootstrapPhase;
  composerErrorMessage: string | null;
  hasPendingAttachments: boolean;
  sessionErrorMessage: string | null;
  selectedModel: string | null;
}): ComposerStatusMessage | null {
  if (input.composerErrorMessage !== null) {
    return {
      message: input.composerErrorMessage,
      variant: "alert",
    };
  }

  if (input.sessionErrorMessage !== null) {
    return {
      message: input.sessionErrorMessage,
      variant: "alert",
    };
  }

  const bootstrapMessage = resolveComposerBootstrapMessage({
    activeComposerModel: input.activeComposerModel,
    bootstrapState: input.bootstrapState,
    selectedModel: input.selectedModel,
  });
  if (bootstrapMessage !== null) {
    return {
      message: bootstrapMessage,
      variant: "alert",
    };
  }

  if (input.hasPendingAttachments && input.activeComposerModel !== null) {
    if (!supportsImageInspection(input.activeComposerModel)) {
      return {
        message: buildNonImageCapableModelWarningMessage(input.activeComposerModel.displayName),
        variant: "default",
      };
    }
  }

  return null;
}
