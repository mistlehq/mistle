import { describe, expect, it } from "vitest";

import {
  buildModelSelectionRequiredMessage,
  buildNonImageCapableModelWarningMessage,
  buildUnavailableModelErrorMessage,
  resolveActiveComposerModel,
  supportsImageInspection,
} from "./session-composer-model-readiness.js";

describe("session-composer-model-readiness", () => {
  it("resolves explicit and default composer models", () => {
    expect(
      resolveActiveComposerModel({
        availableModels: [
          {
            id: "model_default",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            hidden: false,
            defaultReasoningEffort: null,
            inputModalities: ["text", "image"],
            supportsPersonality: false,
            isDefault: true,
          },
          {
            id: "model_fast",
            model: "gpt-5.3-codex-spark",
            displayName: "GPT-5.3 Codex Spark",
            hidden: false,
            defaultReasoningEffort: null,
            inputModalities: ["text"],
            supportsPersonality: false,
            isDefault: false,
          },
        ],
        selectedModel: "gpt-5.3-codex-spark",
      }),
    )?.toMatchObject({
      model: "gpt-5.3-codex-spark",
    });

    expect(
      resolveActiveComposerModel({
        availableModels: [
          {
            id: "model_default",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            hidden: false,
            defaultReasoningEffort: null,
            inputModalities: ["text", "image"],
            supportsPersonality: false,
            isDefault: true,
          },
        ],
        selectedModel: null,
      }),
    )?.toMatchObject({
      model: "gpt-5.4",
    });

    expect(
      resolveActiveComposerModel({
        availableModels: [],
        selectedModel: "removed-model",
      }),
    ).toBeNull();
  });

  it("builds model availability and image capability copy", () => {
    expect(buildUnavailableModelErrorMessage("gpt-legacy")).toBe(
      "Model gpt-legacy is no longer available. Switch to another model to continue.",
    );
    expect(buildModelSelectionRequiredMessage()).toBe("Choose a model before sending a message.");
    expect(buildNonImageCapableModelWarningMessage("Codex Spark")).toBe(
      "Model Codex Spark cannot inspect images. Images will only be sent as file path references.",
    );
  });

  it("detects image inspection support", () => {
    expect(
      supportsImageInspection({
        id: "image_model",
        model: "gpt-5.4",
        displayName: "GPT-5.4",
        hidden: false,
        defaultReasoningEffort: null,
        inputModalities: ["text", "image"],
        supportsPersonality: false,
        isDefault: true,
      }),
    ).toBe(true);
    expect(supportsImageInspection(null)).toBe(false);
  });
});
