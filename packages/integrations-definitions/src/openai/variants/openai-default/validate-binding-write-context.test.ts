import { describe, expect, it } from "vitest";

import type { OpenAiApiKeyBindingConfig } from "./binding-config-schema.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";
import { validateOpenAiBindingWriteContext } from "./validate-binding-write-context.js";

function createTargetConfig() {
  return OpenAiApiKeyTargetConfigSchema.parse({
    api_base_url: "https://api.openai.com",
  });
}

const BindingConfig: OpenAiApiKeyBindingConfig = {
  runtime: {
    runtimeId: "codex",
    config: {},
  },
};

describe("validateOpenAiBindingWriteContext", () => {
  it("returns issue when connection method is missing", () => {
    const result = validateOpenAiBindingWriteContext({
      targetKey: "openai-default",
      bindingIdOrDraftIndex: "draft:0",
      target: {
        familyId: "openai",
        variantId: "openai-default",
        config: createTargetConfig(),
      },
      connection: {
        id: "icn_1",
        config: {},
      },
      binding: {
        kind: "agent",
        config: BindingConfig,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected validation result to fail.");
    }
    expect(result.issues[0]?.code).toBe("openai.missing_connection_method");
  });

  it("returns issue for unsupported connection method", () => {
    const result = validateOpenAiBindingWriteContext({
      targetKey: "openai-default",
      bindingIdOrDraftIndex: "draft:0",
      target: {
        familyId: "openai",
        variantId: "openai-default",
        config: createTargetConfig(),
      },
      connection: {
        id: "icn_1",
        config: {
          connection_method: "unsupported",
        },
      },
      binding: {
        kind: "agent",
        config: BindingConfig,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected validation result to fail.");
    }
    expect(result.issues[0]?.code).toBe("openai.unsupported_connection_method");
  });

  it("accepts a supported connection method", () => {
    const result = validateOpenAiBindingWriteContext({
      targetKey: "openai-default",
      bindingIdOrDraftIndex: "draft:0",
      target: {
        familyId: "openai",
        variantId: "openai-default",
        config: createTargetConfig(),
      },
      connection: {
        id: "icn_1",
        config: {
          connection_method: "api-key",
        },
      },
      binding: {
        kind: "agent",
        config: BindingConfig,
      },
    });

    expect(result.ok).toBe(true);
  });
});
