import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import { describe, expect, it } from "vitest";

import { projectTargetUi } from "./project-target-ui.js";

describe("project-target-ui", () => {
  it("projects OpenAI UI capabilities for valid config", () => {
    const projected = projectTargetUi({
      familyId: "openai",
      variantId: "openai-default",
      config: {
        api_base_url: "https://api.openai.com",
        binding_capabilities: createOpenAiRawBindingCapabilities(),
      },
    });

    expect(projected.targetHealth.configStatus).toBe("valid");
    expect(projected.resolvedBindingUi?.openaiAgent?.kind).toBe("agent");
    expect(projected.resolvedBindingUi?.openaiAgent?.runtime).toBe("codex-cli");
  });

  it("marks OpenAI config invalid when projection parse fails", () => {
    const projected = projectTargetUi({
      familyId: "openai",
      variantId: "openai-default",
      config: {
        api_base_url: "https://api.openai.com",
      },
    });

    expect(projected.targetHealth.configStatus).toBe("invalid");
    expect(projected.resolvedBindingUi).toBeUndefined();
  });
});
