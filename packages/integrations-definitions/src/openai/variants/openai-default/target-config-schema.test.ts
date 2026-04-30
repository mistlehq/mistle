import { describe, expect, it } from "vitest";

import {
  OpenAiApiKeyTargetConfigSchema,
  OpenAiChatGptBaseUrl,
  OpenAiChatGptOriginBaseUrl,
  OpenAiChatGptResponsesApiBaseUrl,
  resolveOpenAiChatGptBaseUrlForConnectionMethod,
  resolveOpenAiResponsesApiBaseUrlForConnectionMethod,
  resolveOpenAiRouteBaseUrlForConnectionMethod,
} from "./target-config-schema.js";

describe("OpenAiApiKeyTargetConfigSchema", () => {
  it("preserves root path without adding defaults", () => {
    const parsed = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com",
    });

    expect(parsed).toEqual({
      apiBaseUrl: "https://api.openai.com/",
    });
  });

  it("preserves non-root paths and strips trailing slash", () => {
    const parsed = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://proxy.example.com/openai-v2/",
    });

    expect(parsed).toEqual({
      apiBaseUrl: "https://proxy.example.com/openai-v2",
    });
  });

  it("fails for invalid URL", () => {
    expect(() =>
      OpenAiApiKeyTargetConfigSchema.parse({
        api_base_url: "not-a-url",
      }),
    ).toThrow(/Invalid URL/);
  });

  it("fails when legacy binding capabilities are present", () => {
    expect(() =>
      OpenAiApiKeyTargetConfigSchema.parse({
        api_base_url: "https://api.openai.com",
        binding_capabilities_by_connection_method: {},
      }),
    ).toThrow(/Unrecognized key/);
  });

  it("resolves the target-config API base URL for API key connections", () => {
    const parsed = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://proxy.example.com/openai-v2/",
    });

    expect(
      resolveOpenAiRouteBaseUrlForConnectionMethod({
        targetConfig: parsed,
        connectionMethod: "api-key",
      }),
    ).toBe("https://proxy.example.com/openai-v2");
  });

  it("resolves the ChatGPT route base URL for device-code connections", () => {
    const parsed = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com/v1",
    });

    expect(
      resolveOpenAiRouteBaseUrlForConnectionMethod({
        targetConfig: parsed,
        connectionMethod: "chatgpt-device-code",
      }),
    ).toBe(OpenAiChatGptOriginBaseUrl);
  });

  it("resolves the ChatGPT responses base URL for device-code connections", () => {
    const parsed = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com/v1",
    });

    expect(
      resolveOpenAiResponsesApiBaseUrlForConnectionMethod({
        targetConfig: parsed,
        connectionMethod: "chatgpt-device-code",
      }),
    ).toBe(OpenAiChatGptResponsesApiBaseUrl);
  });

  it("resolves the ChatGPT backend base URL for device-code connections", () => {
    expect(
      resolveOpenAiChatGptBaseUrlForConnectionMethod({
        connectionMethod: "chatgpt-device-code",
      }),
    ).toBe(OpenAiChatGptBaseUrl);
  });
});
