import type { CodexModelSummary } from "@mistle/integrations-definitions/openai/agent/client";

import type {
  CodexConfigStatus,
  CodexModelCatalogStatus,
} from "../session-agents/codex/session-state/use-codex-session-admin.js";

const NonImageCapableModelWarningMessageSuffix =
  " cannot inspect images. Images will only be sent as file path references.";
const UnavailableModelErrorMessageSuffix =
  " is no longer available. Switch to another model to continue.";
const ModelSelectionRequiredMessage = "Choose a model before sending a message.";
const ModelSelectionLoadingMessage =
  "Wait for the selected model to finish loading before sending a message.";

export type ResolvedComposerModelContext = {
  model: CodexModelSummary;
  selectionKey: string;
};

export type ComposerSubmitReadiness =
  | {
      status: "ready";
      activeModel: CodexModelSummary;
    }
  | {
      status: "missing-model";
      message: string;
    }
  | {
      status: "loading-model";
      selectedModel: string;
      message: string;
    }
  | {
      status: "unavailable-model";
      selectedModel: string;
      message: string;
    };

export type ComposerStatusMessage = {
  message: string;
  tone: "error" | "warning";
};

export function supportsImageInspection(model: CodexModelSummary | null): boolean {
  return model?.inputModalities.includes("image") ?? false;
}

export function resolveActiveComposerModel(input: {
  availableModels: readonly CodexModelSummary[];
  selectedModel: string | null;
}): CodexModelSummary | null {
  if (input.selectedModel !== null) {
    return input.availableModels.find((model) => model.model === input.selectedModel) ?? null;
  }

  return input.availableModels.find((model) => model.isDefault) ?? null;
}

export function buildUnavailableModelErrorMessage(modelName: string): string {
  return `Model ${modelName}${UnavailableModelErrorMessageSuffix}`;
}

export function buildNonImageCapableModelWarningMessage(modelName: string): string {
  return `Model ${modelName}${NonImageCapableModelWarningMessageSuffix}`;
}

export function buildModelSelectionRequiredMessage(): string {
  return ModelSelectionRequiredMessage;
}

export function buildModelSelectionLoadingMessage(): string {
  return ModelSelectionLoadingMessage;
}

export function getComposerSelectionKey(selectedModel: string | null): string {
  return selectedModel ?? "__default__";
}

export function resolveComposerSubmitReadiness(input: {
  activeModel: CodexModelSummary | null;
  configStatus: CodexConfigStatus;
  modelCatalogStatus: CodexModelCatalogStatus;
  resolvedModel: CodexModelSummary | null;
  selectedModel: string | null;
}): ComposerSubmitReadiness {
  if (input.resolvedModel !== null) {
    return {
      status: "ready",
      activeModel: input.resolvedModel,
    };
  }

  if (input.configStatus === "idle" || input.configStatus === "loading") {
    return {
      status: "loading-model",
      selectedModel: input.selectedModel ?? "__default__",
      message: buildModelSelectionLoadingMessage(),
    };
  }

  if (input.activeModel !== null) {
    return {
      status: "ready",
      activeModel: input.activeModel,
    };
  }

  if (input.modelCatalogStatus === "idle" || input.modelCatalogStatus === "loading") {
    return {
      status: "loading-model",
      selectedModel: input.selectedModel ?? "__default__",
      message: buildModelSelectionLoadingMessage(),
    };
  }

  if (input.selectedModel === null) {
    return {
      status: "missing-model",
      message: buildModelSelectionRequiredMessage(),
    };
  }

  return {
    status: "unavailable-model",
    selectedModel: input.selectedModel,
    message: buildUnavailableModelErrorMessage(input.selectedModel),
  };
}

export function resolveComposerStatusMessage(input: {
  composerErrorMessage: string | null;
  hasPendingAttachments: boolean;
  submitReadiness: ComposerSubmitReadiness;
}): ComposerStatusMessage | null {
  if (input.composerErrorMessage !== null) {
    return {
      message: input.composerErrorMessage,
      tone: "error",
    };
  }

  if (input.submitReadiness.status !== "ready") {
    return {
      message: input.submitReadiness.message,
      tone: "error",
    };
  }

  if (input.hasPendingAttachments && !supportsImageInspection(input.submitReadiness.activeModel)) {
    return {
      message: buildNonImageCapableModelWarningMessage(
        input.submitReadiness.activeModel.displayName,
      ),
      tone: "warning",
    };
  }

  return null;
}
