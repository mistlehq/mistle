import { describe, expect, it } from "vitest";

import { createOpenAiRawBindingCapabilitiesByConnectionMethod } from "./model-capabilities.js";
import {
  OpenAiApiKeyTargetConfigSchema,
  OpenAiChatGptResponsesApiBaseUrl,
  resolveOpenAiApiBaseUrlForConnectionMethod,
} from "./target-config-schema.js";

describe("OpenAiApiKeyTargetConfigSchema", () => {
  it("preserves root path without adding defaults", () => {
    const parsed = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com",
      binding_capabilities_by_connection_method:
        createOpenAiRawBindingCapabilitiesByConnectionMethod(),
    });

    expect(parsed).toEqual({
      apiBaseUrl: "https://api.openai.com/",
      bindingCapabilitiesByConnectionMethod: expect.any(Object),
    });
  });

  it("preserves non-root paths and strips trailing slash", () => {
    const parsed = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://proxy.example.com/openai-v2/",
      binding_capabilities_by_connection_method:
        createOpenAiRawBindingCapabilitiesByConnectionMethod(),
    });

    expect(parsed).toEqual({
      apiBaseUrl: "https://proxy.example.com/openai-v2",
      bindingCapabilitiesByConnectionMethod: expect.any(Object),
    });
  });

  it("fails for invalid URL", () => {
    expect(() =>
      OpenAiApiKeyTargetConfigSchema.parse({
        api_base_url: "not-a-url",
        binding_capabilities_by_connection_method:
          createOpenAiRawBindingCapabilitiesByConnectionMethod(),
      }),
    ).toThrow(/Invalid URL/);
  });

  it("fails when binding capabilities by connection method are missing", () => {
    expect(() =>
      OpenAiApiKeyTargetConfigSchema.parse({
        api_base_url: "https://api.openai.com",
      }),
    ).toThrow(/Invalid input/);
  });

  it("resolves the target-config API base URL for API key connections", () => {
    const parsed = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://proxy.example.com/openai-v2/",
      binding_capabilities_by_connection_method:
        createOpenAiRawBindingCapabilitiesByConnectionMethod(),
    });

    expect(
      resolveOpenAiApiBaseUrlForConnectionMethod({
        targetConfig: parsed,
        connectionMethod: "api-key",
      }),
    ).toBe("https://proxy.example.com/openai-v2");
  });

  it("resolves the ChatGPT responses base URL for device-code connections", () => {
    const parsed = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com/v1",
      binding_capabilities_by_connection_method:
        createOpenAiRawBindingCapabilitiesByConnectionMethod(),
    });

    expect(
      resolveOpenAiApiBaseUrlForConnectionMethod({
        targetConfig: parsed,
        connectionMethod: "chatgpt-device-code",
      }),
    ).toBe(OpenAiChatGptResponsesApiBaseUrl);
  });
});
