import { describe, expect, it } from "vitest";

import {
  createOpenAiRawBindingCapabilities,
  createOpenAiRawBindingCapabilitiesByConnectionMethod,
  isOpenAiModelSupported,
  resolveOpenAiCapabilitySetForConnectionMethod,
  isOpenAiReasoningEffortSupported,
  OpenAiCapabilities,
  OpenAiCapabilitiesSchema,
  OpenAiDefaultModelId,
  resolveOpenAiDefaultReasoningEffort,
} from "./model-capabilities.js";

describe("OpenAI model capabilities", () => {
  it("parses the canonical capability payload", () => {
    const parsed = OpenAiCapabilitiesSchema.parse(OpenAiCapabilities);
    expect(parsed.models[0]).toBe(OpenAiDefaultModelId);
    expect(parsed.models).toContain("gpt-5.4");
    expect(parsed.models).toContain("gpt-5.4-mini");
    expect(parsed.models).toContain("gpt-5.3-codex");
    expect(parsed.models).toContain("gpt-5.1-codex-mini");
  });

  it("supports model and reasoning checks", () => {
    expect(isOpenAiModelSupported({ model: "gpt-5.4" })).toBe(true);
    expect(isOpenAiModelSupported({ model: "gpt-5.4-mini" })).toBe(true);
    expect(isOpenAiModelSupported({ model: "gpt-5.3-codex" })).toBe(true);
    expect(
      isOpenAiReasoningEffortSupported({
        model: "gpt-5.4",
        reasoningEffort: "xhigh",
      }),
    ).toBe(true);
    expect(
      isOpenAiReasoningEffortSupported({
        model: "gpt-5.4-mini",
        reasoningEffort: "xhigh",
      }),
    ).toBe(true);
    expect(
      isOpenAiReasoningEffortSupported({
        model: "gpt-5.3-codex",
        reasoningEffort: "xhigh",
      }),
    ).toBe(true);
    expect(
      isOpenAiReasoningEffortSupported({
        model: "gpt-5.1-codex-mini",
        reasoningEffort: "low",
      }),
    ).toBe(false);
  });

  it("resolves default reasoning effort per model", () => {
    expect(
      resolveOpenAiDefaultReasoningEffort({
        model: "gpt-5.4",
      }),
    ).toBe("medium");
  });

  it("builds raw target-config payload shape for seeding", () => {
    const raw = createOpenAiRawBindingCapabilities();
    expect(raw.models[0]).toBe(OpenAiDefaultModelId);
    expect(raw.default_reasoning_by_model["gpt-5.4"]).toBe("medium");
    expect(raw.default_reasoning_by_model["gpt-5.4-mini"]).toBe("medium");
  });

  it("builds per-method raw target-config payload shape for seeding", () => {
    const raw = createOpenAiRawBindingCapabilitiesByConnectionMethod();
    expect(raw["api-key"].models[0]).toBe(OpenAiDefaultModelId);
    expect(raw["chatgpt-device-code"].default_reasoning_by_model["gpt-5.4"]).toBe("medium");
  });

  it("resolves capability sets by connection method", () => {
    const capabilitySet = resolveOpenAiCapabilitySetForConnectionMethod({
      bindingCapabilitiesByConnectionMethod: {
        "api-key": {
          models: ["gpt-5.4"],
          allowedReasoningByModel: {
            "gpt-5.4": ["medium"],
            "gpt-5.4-mini": ["low"],
            "gpt-5.3-codex": ["low"],
            "gpt-5.3-codex-spark": ["low"],
            "gpt-5.2-codex": ["low"],
            "gpt-5.1-codex-max": ["low"],
            "gpt-5.2": ["low"],
            "gpt-5.1-codex-mini": ["medium"],
          },
          defaultReasoningByModel: {
            "gpt-5.4": "medium",
            "gpt-5.4-mini": "low",
            "gpt-5.3-codex": "low",
            "gpt-5.3-codex-spark": "low",
            "gpt-5.2-codex": "low",
            "gpt-5.1-codex-max": "low",
            "gpt-5.2": "low",
            "gpt-5.1-codex-mini": "medium",
          },
        },
        "chatgpt-device-code": OpenAiCapabilities,
      },
      connectionMethod: "api-key",
    });

    expect(capabilitySet.models).toEqual(["gpt-5.4"]);
  });
});
