import { describe, expect, it } from "vitest";

import {
  createDefaultOpenAiBindingConfig,
  parseOpenAiAgentBindingConfig,
  readOpenAiAuthScheme,
  resolveOpenAiCapabilitySet,
  type OpenAiResolvedBindingUi,
} from "./openai-binding-capabilities.js";

const SAMPLE_RESOLVED_BINDING_UI: OpenAiResolvedBindingUi = {
  openaiAgent: {
    kind: "agent",
    runtime: "codex-cli",
    familyId: "openai",
    variantId: "openai-default",
    byAuthScheme: {
      "api-key": {
        models: ["gpt-5.3-codex", "gpt-5.1-codex-mini"],
        allowedReasoningByModel: {
          "gpt-5.3-codex": ["low", "medium", "high", "xhigh"],
          "gpt-5.1-codex-mini": ["medium", "high"],
        },
        defaultReasoningByModel: {
          "gpt-5.3-codex": "medium",
          "gpt-5.1-codex-mini": "medium",
        },
        reasoningLabels: {
          low: "Low",
          medium: "Medium",
          high: "High",
          xhigh: "Extra High",
        },
      },
      oauth: {
        models: ["gpt-5.3-codex-spark"],
        allowedReasoningByModel: {
          "gpt-5.3-codex-spark": ["low", "medium", "high", "xhigh"],
        },
        defaultReasoningByModel: {
          "gpt-5.3-codex-spark": "high",
        },
        reasoningLabels: {
          low: "Low",
          medium: "Medium",
          high: "High",
          xhigh: "Extra High",
        },
      },
    },
  },
};

describe("openai binding capabilities", () => {
  it("reads supported auth scheme from connection config", () => {
    expect(readOpenAiAuthScheme({ auth_scheme: "api-key" })).toBe("api-key");
    expect(readOpenAiAuthScheme({ auth_scheme: "oauth" })).toBe("oauth");
    expect(readOpenAiAuthScheme({ auth_scheme: "unsupported" })).toBeUndefined();
    expect(readOpenAiAuthScheme(undefined)).toBeUndefined();
  });

  it("resolves capability set for auth scheme", () => {
    expect(
      resolveOpenAiCapabilitySet({
        resolvedBindingUi: SAMPLE_RESOLVED_BINDING_UI,
        authScheme: "api-key",
      })?.models,
    ).toEqual(["gpt-5.3-codex", "gpt-5.1-codex-mini"]);

    expect(
      resolveOpenAiCapabilitySet({
        resolvedBindingUi: SAMPLE_RESOLVED_BINDING_UI,
        authScheme: "oauth",
      })?.models,
    ).toEqual(["gpt-5.3-codex-spark"]);
  });

  it("creates default config from capability set", () => {
    const config = createDefaultOpenAiBindingConfig({
      capabilitySet: resolveOpenAiCapabilitySet({
        resolvedBindingUi: SAMPLE_RESOLVED_BINDING_UI,
        authScheme: "api-key",
      }),
    });

    expect(config).toEqual({
      runtime: "codex-cli",
      defaultModel: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });
  });

  it("parses canonical openai binding config without semantic compatibility checks", () => {
    expect(
      parseOpenAiAgentBindingConfig({
        runtime: "codex-cli",
        defaultModel: "unknown-model",
        reasoningEffort: "xhigh",
      }),
    ).toEqual({
      runtime: "codex-cli",
      defaultModel: "unknown-model",
      reasoningEffort: "xhigh",
    });

    expect(
      parseOpenAiAgentBindingConfig({
        runtime: "codex-cli",
        defaultModel: "gpt-5.3-codex",
        reasoningEffort: "extra_high",
      }),
    ).toBeUndefined();
  });
});
