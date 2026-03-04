import { describe, expect, it } from "vitest";

import {
  createOpenAiRawBindingCapabilities,
  isOpenAiModelSupported,
  isOpenAiReasoningEffortSupported,
  OpenAiCapabilitiesByAuthScheme,
  OpenAiCapabilitiesByAuthSchemeSchema,
  resolveOpenAiDefaultReasoningEffort,
} from "./model-capabilities.js";

describe("OpenAI model capabilities", () => {
  it("parses canonical capability payload for all auth schemes", () => {
    const parsed = OpenAiCapabilitiesByAuthSchemeSchema.parse(OpenAiCapabilitiesByAuthScheme);
    expect(parsed["api-key"].models).toContain("gpt-5.3-codex");
    expect(parsed.oauth.models).toContain("gpt-5.1-codex-mini");
  });

  it("supports model and reasoning checks by auth scheme", () => {
    expect(isOpenAiModelSupported({ authScheme: "api-key", model: "gpt-5.3-codex" })).toBe(true);
    expect(
      isOpenAiReasoningEffortSupported({
        authScheme: "api-key",
        model: "gpt-5.3-codex",
        reasoningEffort: "xhigh",
      }),
    ).toBe(true);
    expect(
      isOpenAiReasoningEffortSupported({
        authScheme: "oauth",
        model: "gpt-5.1-codex-mini",
        reasoningEffort: "low",
      }),
    ).toBe(false);
  });

  it("resolves default reasoning effort per model", () => {
    expect(
      resolveOpenAiDefaultReasoningEffort({
        authScheme: "api-key",
        model: "gpt-5.3-codex-spark",
      }),
    ).toBe("high");
  });

  it("builds raw target-config payload shape for seeding", () => {
    const raw = createOpenAiRawBindingCapabilities();
    expect(raw.by_auth_scheme["api-key"].default_reasoning_by_model["gpt-5.3-codex"]).toBe(
      "medium",
    );
  });
});
