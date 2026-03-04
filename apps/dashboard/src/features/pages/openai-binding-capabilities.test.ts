import {
  createOpenAiRawBindingCapabilities,
  OpenAiApiKeyTargetConfigSchema,
  projectOpenAiTargetUi,
} from "@mistle/integrations-definitions";
import { describe, expect, it } from "vitest";

import {
  createDefaultOpenAiBindingConfig,
  parseOpenAiAgentBindingConfig,
  readOpenAiAuthScheme,
  resolveOpenAiCapabilitySet,
} from "./openai-binding-capabilities.js";

function createSampleResolvedBindingUi(): Record<string, unknown> {
  const targetConfig = OpenAiApiKeyTargetConfigSchema.parse({
    api_base_url: "https://api.openai.com",
    binding_capabilities: createOpenAiRawBindingCapabilities(),
  });
  return projectOpenAiTargetUi({
    targetConfig,
  });
}

const SAMPLE_RESOLVED_BINDING_UI = createSampleResolvedBindingUi();

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
    ).toEqual([
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.1-codex-max",
      "gpt-5.2",
      "gpt-5.1-codex-mini",
    ]);

    expect(
      resolveOpenAiCapabilitySet({
        resolvedBindingUi: SAMPLE_RESOLVED_BINDING_UI,
        authScheme: "oauth",
      })?.models,
    ).toEqual([
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.1-codex-max",
      "gpt-5.2",
      "gpt-5.1-codex-mini",
    ]);
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
