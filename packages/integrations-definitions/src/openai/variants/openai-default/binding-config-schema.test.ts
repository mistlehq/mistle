import { describe, expect, it } from "vitest";

import {
  OpenAiAllowedRuntimeIds,
  OpenAiApiKeyBindingConfigSchema,
} from "./binding-config-schema.js";

describe("OpenAiApiKeyBindingConfigSchema", () => {
  it("parses valid OpenAI agent runtime binding configs", () => {
    const parsed = OpenAiApiKeyBindingConfigSchema.parse({
      runtime: {
        runtimeId: OpenAiAllowedRuntimeIds[0],
        config: {},
      },
    });
    const openCodeParsed = OpenAiApiKeyBindingConfigSchema.parse({
      runtime: {
        runtimeId: "opencode",
        config: {},
      },
    });

    expect(parsed).toEqual({
      runtime: {
        runtimeId: "codex",
        config: {},
      },
    });
    expect(openCodeParsed).toEqual({
      runtime: {
        runtimeId: "opencode",
        config: {},
      },
    });
  });

  it("fails when runtime is not supported", () => {
    expect(() =>
      OpenAiApiKeyBindingConfigSchema.parse({
        runtime: {
          runtimeId: "other",
          config: {},
        },
      }),
    ).toThrow(/Invalid option/);
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
