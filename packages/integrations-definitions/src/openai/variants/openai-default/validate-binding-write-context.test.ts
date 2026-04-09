import { describe, expect, it } from "vitest";

import {
  createOpenAiRawBindingCapabilities,
  createOpenAiRawBindingCapabilitiesByConnectionMethod,
  type OpenAiRawBindingCapabilitiesByConnectionMethod,
} from "./model-capabilities.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";
import { validateOpenAiBindingWriteContext } from "./validate-binding-write-context.js";

function createTargetConfig(
  bindingCapabilitiesByConnectionMethod: OpenAiRawBindingCapabilitiesByConnectionMethod = createOpenAiRawBindingCapabilitiesByConnectionMethod(),
) {
  return OpenAiApiKeyTargetConfigSchema.parse({
    api_base_url: "https://api.openai.com",
    binding_capabilities_by_connection_method: bindingCapabilitiesByConnectionMethod,
  });
}

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
        config: {
          runtime: {
            runtimeId: "codex",
            config: {},
          },
          model: {
            defaultModel: "gpt-5.3-codex",
            options: {
              reasoningEffort: "medium",
            },
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected validation result to fail.");
    }
    expect(result.issues[0]?.code).toBe("openai.missing_connection_method");
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
          connection_method: "api-key",
        },
      },
      binding: {
        kind: "agent",
        config: {
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
          connection_method: "api-key",
        },
      },
      binding: {
        kind: "agent",
        config: {
          runtime: {
            runtimeId: "codex",
            config: {},
          },
          model: {
            defaultModel: "gpt-5.1-codex-mini",
            options: {
              reasoningEffort: "low",
            },
          },
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
      ...createOpenAiRawBindingCapabilitiesByConnectionMethod(),
      "api-key": {
        ...defaultCapabilities,
        allowed_reasoning_by_model: {
          ...defaultCapabilities.allowed_reasoning_by_model,
          "gpt-5.3-codex": ["low"],
        },
        default_reasoning_by_model: {
          ...defaultCapabilities.default_reasoning_by_model,
          "gpt-5.3-codex": "low",
        },
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
          connection_method: "api-key",
        },
      },
      binding: {
        kind: "agent",
        config: {
          runtime: {
            runtimeId: "codex",
            config: {},
          },
          model: {
            defaultModel: "gpt-5.3-codex",
            options: {
              reasoningEffort: "medium",
            },
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected validation result to fail.");
    }
    expect(result.issues[0]?.code).toBe("openai.unsupported_reasoning_for_model");
  });

  it("uses the selected connection method capability set", () => {
    const defaultCapabilities = createOpenAiRawBindingCapabilities();
    const targetConfig = createTargetConfig({
      ...createOpenAiRawBindingCapabilitiesByConnectionMethod(),
      "chatgpt-device-code": {
        ...defaultCapabilities,
        models: ["gpt-5.4"],
        allowed_reasoning_by_model: {
          ...defaultCapabilities.allowed_reasoning_by_model,
          "gpt-5.4": ["high"],
        },
        default_reasoning_by_model: {
          ...defaultCapabilities.default_reasoning_by_model,
          "gpt-5.4": "high",
        },
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
          connection_method: "chatgpt-device-code",
          auth_mode: "chatgpt",
          chatgpt_account_id: "acct_123",
        },
      },
      binding: {
        kind: "agent",
        config: {
          runtime: {
            runtimeId: "codex",
            config: {},
          },
          model: {
            defaultModel: "gpt-5.3-codex",
            options: {
              reasoningEffort: "medium",
            },
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected validation result to fail.");
    }
    expect(result.issues[0]?.code).toBe("openai.unsupported_model_for_connection_method");
  });
});
