import {
  buildModelSelectionRequiredMessage,
  buildNonImageCapableModelWarningMessage,
  buildUnavailableModelErrorMessage,
  supportsImageInspection,
} from "./session-composer-model-readiness.js";
import type {
  SessionComposerBootstrapPhase,
  SessionComposerModel,
} from "./session-composer-runtime-contracts.js";

export type ComposerStatusMessage = {
  message: string;
  variant: "alert" | "default";
  presentation?: "loading" | "notice";
};

export function resolveComposerBootstrapMessage(input: {
  activeComposerModel: SessionComposerModel | null;
  bootstrapState: SessionComposerBootstrapPhase;
  requiresModelSelection: boolean;
  selectedModel: string | null;
}): string | null {
  if (!input.requiresModelSelection) {
    return null;
  }

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
  activeComposerModel: SessionComposerModel | null;
  bootstrapState: SessionComposerBootstrapPhase;
  composerErrorMessage: string | null;
  completedTurnErrorMessage: string | null;
  hasPendingImageAttachments: boolean;
  isUploadingAttachments: boolean;
  requiresModelSelection: boolean;
  sessionErrorMessage: string | null;
  selectedModel: string | null;
}): ComposerStatusMessage | null {
  if (input.composerErrorMessage !== null) {
    return {
      message: input.composerErrorMessage,
      variant: "alert",
    };
  }

  if (input.completedTurnErrorMessage !== null) {
    return {
      message: input.completedTurnErrorMessage,
      variant: "alert",
    };
  }

  if (input.sessionErrorMessage !== null) {
    return {
      message: input.sessionErrorMessage,
      variant: "alert",
    };
  }

  if (input.isUploadingAttachments) {
    return {
      message: "Uploading attachments...",
      variant: "default",
      presentation: "loading",
    };
  }

  const bootstrapMessage = resolveComposerBootstrapMessage({
    activeComposerModel: input.activeComposerModel,
    bootstrapState: input.bootstrapState,
    requiresModelSelection: input.requiresModelSelection,
    selectedModel: input.selectedModel,
  });
  if (bootstrapMessage !== null) {
    return {
      message: bootstrapMessage,
      variant: "alert",
    };
  }

  if (input.hasPendingImageAttachments && input.activeComposerModel !== null) {
    if (!supportsImageInspection(input.activeComposerModel)) {
      return {
        message: buildNonImageCapableModelWarningMessage(input.activeComposerModel.displayName),
        variant: "default",
      };
    }
  }

  return null;
}
