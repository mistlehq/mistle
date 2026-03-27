import type { CodexModelSummary } from "@mistle/integrations-definitions/openai/agent/client";

import type { SessionBootstrapState } from "../session-agents/codex/session-state/use-codex-session-bootstrap.js";
import {
  buildModelSelectionRequiredMessage,
  buildNonImageCapableModelWarningMessage,
  supportsImageInspection,
} from "./session-composer-model-readiness.js";

export type ComposerStatusMessage = {
  message: string;
  tone: "error" | "warning";
};

export function resolveComposerBootstrapMessage(input: {
  activeComposerModel: CodexModelSummary | null;
  bootstrapState: SessionBootstrapState;
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

  return buildModelSelectionRequiredMessage();
}

export function resolveComposerStatusMessage(input: {
  activeComposerModel: CodexModelSummary | null;
  bootstrapState: SessionBootstrapState;
  composerErrorMessage: string | null;
  hasPendingAttachments: boolean;
}): ComposerStatusMessage | null {
  if (input.composerErrorMessage !== null) {
    return {
      message: input.composerErrorMessage,
      tone: "error",
    };
  }

  const bootstrapMessage = resolveComposerBootstrapMessage({
    activeComposerModel: input.activeComposerModel,
    bootstrapState: input.bootstrapState,
  });
  if (bootstrapMessage !== null) {
    return {
      message: bootstrapMessage,
      tone: "error",
    };
  }

  if (input.hasPendingAttachments && input.activeComposerModel !== null) {
    if (!supportsImageInspection(input.activeComposerModel)) {
      return {
        message: buildNonImageCapableModelWarningMessage(input.activeComposerModel.displayName),
        tone: "warning",
      };
    }
  }

  return null;
}
