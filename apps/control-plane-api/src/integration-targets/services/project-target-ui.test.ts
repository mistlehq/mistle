import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { projectTargetUi } from "./project-target-ui.js";

const OpenAiProjectionSchema = z
  .object({
    openaiAgent: z
      .object({
        kind: z.literal("agent"),
        runtime: z.literal("codex-cli"),
      })
      .loose(),
  })
  .strict();

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
    const openAiProjection = OpenAiProjectionSchema.parse(projected.resolvedBindingUi);
    expect(openAiProjection.openaiAgent.kind).toBe("agent");
    expect(openAiProjection.openaiAgent.runtime).toBe("codex-cli");
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

  it("returns valid target health without projection for definitions that do not project ui", () => {
    const projected = projectTargetUi({
      familyId: "github",
      variantId: "github-cloud",
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    });

    expect(projected.targetHealth.configStatus).toBe("valid");
    expect(projected.resolvedBindingUi).toBeUndefined();
  });
});
