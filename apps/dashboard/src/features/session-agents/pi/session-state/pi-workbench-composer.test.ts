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

  it("maps Pi models into composer models without treating the active model as a default", () => {
    expect(
      mapPiModelsToComposerModels({
        availableModels: [
          {
            provider: "anthropic",
            id: "claude-sonnet-4.5",
            name: "Claude Sonnet 4.5",
            input: ["text"],
            reasoning: false,
          },
          {
            provider: "openai",
            id: "gpt-5",
            name: "GPT-5",
            input: ["text", "image"],
            reasoning: true,
            thinkingLevelMap: {
              xhigh: "xhigh",
            },
          },
        ],
      }),
    ).toEqual([
      {
        model: "anthropic/claude-sonnet-4.5",
        displayName: "anthropic / Claude Sonnet 4.5",
        defaultReasoningEffort: null,
        reasoningEffortOptions: [],
        inputModalities: ["text"],
        isDefault: false,
      },
      {
        model: "openai/gpt-5",
        displayName: "openai / GPT-5",
        defaultReasoningEffort: null,
        reasoningEffortOptions: [
          { value: "off", label: "Off" },
          { value: "minimal", label: "Minimal" },
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
          { value: "xhigh", label: "Extra high" },
        ],
        inputModalities: ["text", "image"],
        isDefault: false,
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
          reasoning: true,
        },
        availableModels: [
          {
            provider: "openrouter",
            id: "openai/gpt-5",
            name: "GPT-5",
            input: ["text", "image"],
            reasoning: true,
          },
        ],
        thinkingLevel: "high",
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
            reasoningEffortOptions: [
              { value: "off", label: "Off" },
              { value: "minimal", label: "Minimal" },
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
              { value: "xhigh", label: "Extra high" },
            ],
            inputModalities: ["text", "image"],
            isDefault: false,
          },
        ],
        configSnapshot: {
          model: "openrouter/openai/gpt-5",
          modelReasoningEffort: "high",
        },
      },
    });
  });

  it("uses every standard Pi thinking level when the model does not provide a level map", () => {
    expect(
      mapPiModelsToComposerModels({
        availableModels: [
          {
            provider: "openai-codex",
            id: "gpt-5.2-codex",
            name: "GPT-5.2 Codex",
            input: ["text", "image"],
            reasoning: true,
          },
        ],
      })[0]?.reasoningEffortOptions,
    ).toEqual([
      { value: "off", label: "Off" },
      { value: "minimal", label: "Minimal" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "Extra high" },
    ]);
  });

  it("removes Pi thinking levels that the model explicitly disables", () => {
    expect(
      mapPiModelsToComposerModels({
        availableModels: [
          {
            provider: "example",
            id: "model",
            name: "Model",
            input: ["text"],
            reasoning: true,
            thinkingLevelMap: {
              xhigh: null,
            },
          },
        ],
      })[0]?.reasoningEffortOptions,
    ).toEqual([
      { value: "off", label: "Off" },
      { value: "minimal", label: "Minimal" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ]);
  });
});
