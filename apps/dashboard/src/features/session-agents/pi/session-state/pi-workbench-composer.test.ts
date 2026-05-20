import { describe, expect, it } from "vitest";

import {
  buildPiModelSelectionValue,
  buildReadyPiComposerBootstrap,
  mapPiModelsToComposerModels,
  parsePiModelSelectionValue,
} from "./pi-workbench-composer.js";

describe("Pi workbench composer adapter", () => {
  it("parses provider and model id while preserving slashes inside model ids", () => {
    expect(parsePiModelSelectionValue("openrouter/openai/gpt-5")).toEqual({
      provider: "openrouter",
      modelId: "openai/gpt-5",
    });
  });

  it("rejects invalid Pi model selection values", () => {
    expect(() => parsePiModelSelectionValue("gpt-5")).toThrow(
      "Invalid Pi model selection 'gpt-5'.",
    );
    expect(() => parsePiModelSelectionValue("openai/")).toThrow(
      "Invalid Pi model selection 'openai/'.",
    );
  });

  it("formats canonical Pi model selection values", () => {
    expect(
      buildPiModelSelectionValue({
        provider: "openrouter",
        modelId: "openai/gpt-5",
      }),
    ).toBe("openrouter/openai/gpt-5");
  });

  it("maps Pi models into composer models and marks the active model as default", () => {
    expect(
      mapPiModelsToComposerModels({
        activeModel: {
          provider: "openai",
          id: "gpt-5",
          name: "GPT-5",
          input: ["text", "image"],
        },
        availableModels: [
          {
            provider: "anthropic",
            id: "claude-sonnet-4.5",
            name: "Claude Sonnet 4.5",
            input: ["text"],
          },
          {
            provider: "openai",
            id: "gpt-5",
            name: "GPT-5",
            input: ["text", "image"],
          },
        ],
      }),
    ).toEqual([
      {
        model: "anthropic/claude-sonnet-4.5",
        displayName: "anthropic / Claude Sonnet 4.5",
        defaultReasoningEffort: null,
        inputModalities: ["text"],
        isDefault: false,
      },
      {
        model: "openai/gpt-5",
        displayName: "openai / GPT-5",
        defaultReasoningEffort: null,
        inputModalities: ["text", "image"],
        isDefault: true,
      },
    ]);
  });

  it("builds composer bootstrap from Pi runtime model state", () => {
    expect(
      buildReadyPiComposerBootstrap({
        activeModel: {
          provider: "openrouter",
          id: "openai/gpt-5",
          name: "GPT-5",
          input: ["text", "image"],
        },
        availableModels: [
          {
            provider: "openrouter",
            id: "openai/gpt-5",
            name: "GPT-5",
            input: ["text", "image"],
          },
        ],
      }),
    ).toEqual({
      phase: { status: "ready" },
      composerCapabilities: [],
      establishedSnapshot: {
        availableModels: [
          {
            model: "openrouter/openai/gpt-5",
            displayName: "openrouter / GPT-5",
            defaultReasoningEffort: null,
            inputModalities: ["text", "image"],
            isDefault: true,
          },
        ],
        configSnapshot: {
          model: "openrouter/openai/gpt-5",
          modelReasoningEffort: null,
        },
      },
    });
  });
});
