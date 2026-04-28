import { describe, expect, it } from "vitest";

import {
  OpenAiAllowedRuntimeIds,
  OpenAiApiKeyBindingConfigSchema,
} from "./binding-config-schema.js";

describe("OpenAiApiKeyBindingConfigSchema", () => {
  it("parses a valid codex binding config", () => {
    const parsed = OpenAiApiKeyBindingConfigSchema.parse({
      runtime: {
        runtimeId: OpenAiAllowedRuntimeIds[0],
        config: {},
      },
    });

    expect(parsed).toEqual({
      runtime: {
        runtimeId: "codex",
        config: {},
      },
    });
  });

  it("fails when runtime is not codex", () => {
    expect(() =>
      OpenAiApiKeyBindingConfigSchema.parse({
        runtime: {
          runtimeId: "other",
          config: {},
        },
      }),
    ).toThrow(/Invalid input/);
  });

  it("fails when model settings are provided", () => {
    expect(() =>
      OpenAiApiKeyBindingConfigSchema.parse({
        runtime: {
          runtimeId: "codex",
          config: {},
        },
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
