import { describe, expect, it } from "vitest";

import { OpenAiApiKeyBindingConfigSchema, OpenAiRuntimes } from "./binding-config-schema.js";

describe("OpenAiApiKeyBindingConfigSchema", () => {
  it("parses a valid codex binding config", () => {
    const parsed = OpenAiApiKeyBindingConfigSchema.parse({
      runtime: OpenAiRuntimes.CODEX_CLI,
      defaultModel: "gpt-5.4",
      reasoningEffort: "medium",
    });

    expect(parsed).toEqual({
      runtime: "codex-cli",
      defaultModel: "gpt-5.4",
      reasoningEffort: "medium",
    });
  });

  it("parses a valid codex binding config with xhigh reasoning", () => {
    const parsed = OpenAiApiKeyBindingConfigSchema.parse({
      runtime: OpenAiRuntimes.CODEX_CLI,
      defaultModel: "gpt-5.3-codex",
      reasoningEffort: "xhigh",
    });

    expect(parsed).toEqual({
      runtime: "codex-cli",
      defaultModel: "gpt-5.3-codex",
      reasoningEffort: "xhigh",
    });
  });

  it("parses additional instructions when provided", () => {
    const parsed = OpenAiApiKeyBindingConfigSchema.parse({
      runtime: OpenAiRuntimes.CODEX_CLI,
      defaultModel: "gpt-5.3-codex",
      reasoningEffort: "medium",
      additionalInstructions: "Prefer concise answers.",
    });

    expect(parsed).toEqual({
      runtime: "codex-cli",
      defaultModel: "gpt-5.3-codex",
      reasoningEffort: "medium",
      additionalInstructions: "Prefer concise answers.",
    });
  });

  it("omits additional instructions when the input is blank", () => {
    const parsed = OpenAiApiKeyBindingConfigSchema.parse({
      runtime: OpenAiRuntimes.CODEX_CLI,
      defaultModel: "gpt-5.3-codex",
      reasoningEffort: "medium",
      additionalInstructions: "   ",
    });

    expect(parsed).toEqual({
      runtime: "codex-cli",
      defaultModel: "gpt-5.3-codex",
      reasoningEffort: "medium",
      additionalInstructions: undefined,
    });
  });

  it("fails for unsupported default model", () => {
    expect(() =>
      OpenAiApiKeyBindingConfigSchema.parse({
        runtime: "codex-cli",
        defaultModel: "gpt-4.1",
        reasoningEffort: "medium",
      }),
    ).toThrow();
  });

  it("fails when runtime is not codex-cli", () => {
    expect(() =>
      OpenAiApiKeyBindingConfigSchema.parse({
        runtime: "other",
        defaultModel: "gpt-5.3-codex",
        reasoningEffort: "medium",
      }),
    ).toThrow();
  });

  it("fails when reasoning effort is missing", () => {
    expect(() =>
      OpenAiApiKeyBindingConfigSchema.parse({
        runtime: "codex-cli",
        defaultModel: "gpt-5.3-codex",
      }),
    ).toThrow();
  });
});
