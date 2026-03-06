import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import { describe, expect, it } from "vitest";

import { projectTargetUi } from "./project-target-ui.js";

describe("project-target-ui", () => {
  it("marks OpenAI config valid when target config parses", () => {
    const projected = projectTargetUi({
      familyId: "openai",
      variantId: "openai-default",
      config: {
        api_base_url: "https://api.openai.com",
        binding_capabilities: createOpenAiRawBindingCapabilities(),
      },
    });

    expect(projected.targetHealth.configStatus).toBe("valid");
  });

  it("marks OpenAI config invalid when target config parse fails", () => {
    const projected = projectTargetUi({
      familyId: "openai",
      variantId: "openai-default",
      config: {
        api_base_url: "https://api.openai.com",
      },
    });

    expect(projected.targetHealth.configStatus).toBe("invalid");
  });

  it("marks github config valid when target config parses", () => {
    const projected = projectTargetUi({
      familyId: "github",
      variantId: "github-cloud",
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    });

    expect(projected.targetHealth.configStatus).toBe("valid");
  });
});
