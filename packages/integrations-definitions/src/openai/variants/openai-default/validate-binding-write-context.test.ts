import { describe, expect, it } from "vitest";

import {
  createOpenAiRawBindingCapabilities,
  type OpenAiRawBindingCapabilities,
} from "./model-capabilities.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";
import { validateOpenAiBindingWriteContext } from "./validate-binding-write-context.js";

function createTargetConfig(
  bindingCapabilities: OpenAiRawBindingCapabilities = createOpenAiRawBindingCapabilities(),
) {
  return OpenAiApiKeyTargetConfigSchema.parse({
    api_base_url: "https://api.openai.com",
    binding_capabilities: bindingCapabilities,
  });
}

describe("validateOpenAiBindingWriteContext", () => {
  it("returns issue when auth scheme is missing", () => {
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
        config: {
          runtime: "codex-cli",
          defaultModel: "gpt-5.3-codex",
          reasoningEffort: "medium",
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected validation result to fail.");
    }
    expect(result.issues[0]?.code).toBe("openai.missing_auth_scheme");
  });

  it("returns issue for unsupported model/reasoning combinations", () => {
    const invalidModel = validateOpenAiBindingWriteContext({
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
          auth_scheme: "api-key",
        },
      },
      binding: {
        kind: "agent",
        config: {
          runtime: "codex-cli",
          defaultModel: "gpt-5.3-codex",
          reasoningEffort: "xhigh",
        },
      },
    });
    expect(invalidModel.ok).toBe(true);

    const invalidReasoning = validateOpenAiBindingWriteContext({
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
          auth_scheme: "api-key",
        },
      },
      binding: {
        kind: "agent",
        config: {
          runtime: "codex-cli",
          defaultModel: "gpt-5.1-codex-mini",
          reasoningEffort: "low",
        },
      },
    });
    expect(invalidReasoning.ok).toBe(false);
    if (invalidReasoning.ok) {
      throw new Error("Expected validation result to fail.");
    }
    expect(invalidReasoning.issues[0]?.code).toBe("openai.unsupported_reasoning_for_model");
  });

  it("uses target binding capabilities when validating model/reasoning", () => {
    const defaultCapabilities = createOpenAiRawBindingCapabilities();
    const targetConfig = createTargetConfig({
      by_auth_scheme: {
        "api-key": {
          ...defaultCapabilities.by_auth_scheme["api-key"],
          allowed_reasoning_by_model: {
            ...defaultCapabilities.by_auth_scheme["api-key"].allowed_reasoning_by_model,
            "gpt-5.3-codex": ["low"],
          },
          default_reasoning_by_model: {
            ...defaultCapabilities.by_auth_scheme["api-key"].default_reasoning_by_model,
            "gpt-5.3-codex": "low",
          },
        },
        oauth: defaultCapabilities.by_auth_scheme.oauth,
      },
    });

    const result = validateOpenAiBindingWriteContext({
      targetKey: "openai-default",
      bindingIdOrDraftIndex: "draft:0",
      target: {
        familyId: "openai",
        variantId: "openai-default",
        config: targetConfig,
      },
      connection: {
        id: "icn_1",
        config: {
          auth_scheme: "api-key",
        },
      },
      binding: {
        kind: "agent",
        config: {
          runtime: "codex-cli",
          defaultModel: "gpt-5.3-codex",
          reasoningEffort: "medium",
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected validation result to fail.");
    }
    expect(result.issues[0]?.code).toBe("openai.unsupported_reasoning_for_model");
  });
});
