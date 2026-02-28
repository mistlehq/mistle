import { describe, expect, it } from "vitest";

import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";

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
    ).toThrowError();
  });
});
