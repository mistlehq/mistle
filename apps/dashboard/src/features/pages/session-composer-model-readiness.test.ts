import { describe, expect, it } from "vitest";

import {
  buildModelSelectionLoadingMessage,
  buildModelSelectionRequiredMessage,
  buildNonImageCapableModelWarningMessage,
  buildUnavailableModelErrorMessage,
  resolveActiveComposerModel,
  resolveComposerStatusMessage,
  resolveComposerSubmitReadiness,
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

  it("builds readiness copy and image-capability copy", () => {
    expect(buildUnavailableModelErrorMessage("gpt-legacy")).toBe(
      "Model gpt-legacy is no longer available. Switch to another model to continue.",
    );
    expect(buildModelSelectionRequiredMessage()).toBe("Choose a model before sending a message.");
    expect(buildModelSelectionLoadingMessage()).toBe(
      "Wait for the selected model to finish loading before sending a message.",
    );
    expect(buildNonImageCapableModelWarningMessage("Codex Spark")).toBe(
      "Model Codex Spark cannot inspect images. Images will only be sent as file path references.",
    );
  });

  it("resolves image support and submit readiness", () => {
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

    expect(
      resolveComposerSubmitReadiness({
        selectedModel: null,
        activeModel: {
          id: "model_default",
          model: "gpt-5.4",
          displayName: "GPT-5.4",
          hidden: false,
          defaultReasoningEffort: null,
          inputModalities: ["text", "image"],
          supportsPersonality: false,
          isDefault: true,
        },
        resolvedModel: null,
        modelCatalogStatus: "loaded",
      }),
    ).toMatchObject({
      status: "ready",
    });

    expect(
      resolveComposerSubmitReadiness({
        selectedModel: null,
        activeModel: null,
        resolvedModel: null,
        modelCatalogStatus: "idle",
      }),
    ).toEqual({
      status: "loading-model",
      selectedModel: "__default__",
      message: "Wait for the selected model to finish loading before sending a message.",
    });

    expect(
      resolveComposerSubmitReadiness({
        selectedModel: "gpt-legacy-preview",
        activeModel: null,
        resolvedModel: null,
        modelCatalogStatus: "loaded",
      }),
    ).toEqual({
      status: "unavailable-model",
      selectedModel: "gpt-legacy-preview",
      message:
        "Model gpt-legacy-preview is no longer available. Switch to another model to continue.",
    });
  });

  it("gives precedence to explicit composer errors over derived notices", () => {
    expect(
      resolveComposerStatusMessage({
        composerErrorMessage: "That file is not a supported PNG, JPEG, WebP, or GIF image.",
        hasPendingAttachments: true,
        submitReadiness: {
          status: "ready",
          activeModel: {
            id: "image_model",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            hidden: false,
            defaultReasoningEffort: null,
            inputModalities: ["text", "image"],
            supportsPersonality: false,
            isDefault: true,
          },
        },
      }),
    ).toEqual({
      message: "That file is not a supported PNG, JPEG, WebP, or GIF image.",
      tone: "error",
    });

    expect(
      resolveComposerStatusMessage({
        composerErrorMessage: null,
        hasPendingAttachments: true,
        submitReadiness: {
          status: "ready",
          activeModel: {
            id: "text_model",
            model: "gpt-5.3-codex-spark",
            displayName: "GPT-5.3 Codex Spark",
            hidden: false,
            defaultReasoningEffort: null,
            inputModalities: ["text"],
            supportsPersonality: false,
            isDefault: false,
          },
        },
      }),
    ).toEqual({
      message:
        "Model GPT-5.3 Codex Spark cannot inspect images. Images will only be sent as file path references.",
      tone: "warning",
    });
  });
});
