import { describe, expect, it } from "vitest";

import { OpenAiApiKeyBindingConfigSchema } from "./binding-config-schema.js";

describe("OpenAiApiKeyBindingConfigSchema", () => {
  it("parses empty OpenAI binding configs", () => {
    const parsed = OpenAiApiKeyBindingConfigSchema.parse({});

    expect(parsed).toEqual({});
  });

  it("fails when runtime settings are provided", () => {
    expect(() =>
      OpenAiApiKeyBindingConfigSchema.parse({
        runtime: {
          runtimeId: "codex",
          config: {},
        },
      }),
    ).toThrow(/Unrecognized key/);
  });

  it("fails when model settings are provided", () => {
    expect(() =>
      OpenAiApiKeyBindingConfigSchema.parse({
        model: {
          defaultModel: "gpt-5.4",
          options: {
            reasoningEffort: "medium",
          },
        },
      }),
    ).toThrow(/Unrecognized key/);
  });
});
