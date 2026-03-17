import { describe, expect, it } from "vitest";

import { createOpenAiRawBindingCapabilities } from "./model-capabilities.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";

describe("OpenAiApiKeyTargetConfigSchema", () => {
  it("preserves root path without adding defaults", () => {
    const parsed = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com",
      binding_capabilities: createOpenAiRawBindingCapabilities(),
    });

    expect(parsed).toEqual({
      apiBaseUrl: "https://api.openai.com/",
      bindingCapabilities: expect.any(Object),
    });
  });

  it("preserves non-root paths and strips trailing slash", () => {
    const parsed = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://proxy.example.com/openai-v2/",
      binding_capabilities: createOpenAiRawBindingCapabilities(),
    });

    expect(parsed).toEqual({
      apiBaseUrl: "https://proxy.example.com/openai-v2",
      bindingCapabilities: expect.any(Object),
    });
  });

  it("fails for invalid URL", () => {
    expect(() =>
      OpenAiApiKeyTargetConfigSchema.parse({
        api_base_url: "not-a-url",
        binding_capabilities: createOpenAiRawBindingCapabilities(),
      }),
    ).toThrowError();
  });

  it("fails when binding capabilities are missing", () => {
    expect(() =>
      OpenAiApiKeyTargetConfigSchema.parse({
        api_base_url: "https://api.openai.com",
      }),
    ).toThrowError();
  });
});
