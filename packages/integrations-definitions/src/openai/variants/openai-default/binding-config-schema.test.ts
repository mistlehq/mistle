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
      model: {
        defaultModel: "gpt-5.4",
        options: {
          reasoningEffort: "medium",
        },
      },
    });

    expect(parsed).toEqual({
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
    });
  });

  it("parses a valid codex binding config with xhigh reasoning", () => {
    const parsed = OpenAiApiKeyBindingConfigSchema.parse({
      runtime: {
        runtimeId: OpenAiAllowedRuntimeIds[0],
        config: {},
      },
      model: {
        defaultModel: "gpt-5.3-codex",
        options: {
          reasoningEffort: "xhigh",
        },
      },
    });

    expect(parsed).toEqual({
      runtime: {
        runtimeId: "codex",
        config: {},
      },
      model: {
        defaultModel: "gpt-5.3-codex",
        options: {
          reasoningEffort: "xhigh",
        },
      },
    });
  });

  it("parses additional instructions when provided", () => {
    const parsed = OpenAiApiKeyBindingConfigSchema.parse({
      runtime: {
        runtimeId: OpenAiAllowedRuntimeIds[0],
        config: {},
      },
      model: {
        defaultModel: "gpt-5.3-codex",
        options: {
          reasoningEffort: "medium",
          additionalInstructions: "Prefer concise answers.",
        },
      },
    });

    expect(parsed).toEqual({
      runtime: {
        runtimeId: "codex",
        config: {},
      },
      model: {
        defaultModel: "gpt-5.3-codex",
        options: {
          reasoningEffort: "medium",
          additionalInstructions: "Prefer concise answers.",
        },
      },
    });
  });

  it("omits additional instructions when the input is blank", () => {
    const parsed = OpenAiApiKeyBindingConfigSchema.parse({
      runtime: {
        runtimeId: OpenAiAllowedRuntimeIds[0],
        config: {},
      },
      model: {
        defaultModel: "gpt-5.3-codex",
        options: {
          reasoningEffort: "medium",
          additionalInstructions: "   ",
        },
      },
    });

    expect(parsed).toEqual({
      runtime: {
        runtimeId: "codex",
        config: {},
      },
      model: {
        defaultModel: "gpt-5.3-codex",
        options: {
          reasoningEffort: "medium",
          additionalInstructions: undefined,
        },
      },
    });
  });

  it("fails for unsupported default model", () => {
    expect(() =>
      OpenAiApiKeyBindingConfigSchema.parse({
        runtime: {
          runtimeId: "codex",
          config: {},
        },
        model: {
          defaultModel: "gpt-4.1",
          options: {
            reasoningEffort: "medium",
          },
        },
      }),
    ).toThrow(/Invalid option/);
  });

  it("fails when runtime is not codex", () => {
    expect(() =>
      OpenAiApiKeyBindingConfigSchema.parse({
        runtime: {
          runtimeId: "other",
          config: {},
        },
        model: {
          defaultModel: "gpt-5.3-codex",
          options: {
            reasoningEffort: "medium",
          },
        },
      }),
    ).toThrow(/Invalid input/);
  });

  it("fails when reasoning effort is missing", () => {
    expect(() =>
      OpenAiApiKeyBindingConfigSchema.parse({
        runtime: {
          runtimeId: "codex",
          config: {},
        },
        model: {
          defaultModel: "gpt-5.3-codex",
          options: {},
        },
      }),
    ).toThrow(/Invalid option/);
  });
});
