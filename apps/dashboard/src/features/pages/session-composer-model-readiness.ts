import type { CodexModelSummary } from "@mistle/integrations-definitions/openai/agent/client";

const NonImageCapableModelWarningMessageSuffix =
  " cannot inspect images. Images will only be sent as file path references.";
const UnavailableModelErrorMessageSuffix =
  " is no longer available. Switch to another model to continue.";
const ModelSelectionRequiredMessage = "Choose a model before sending a message.";

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
