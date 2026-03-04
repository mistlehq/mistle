import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import { parseIntegrationBindingEditorUiProjection } from "@mistle/integrations-definitions/ui";
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
    const bindingEditorProjection = parseIntegrationBindingEditorUiProjection(
      projected.resolvedBindingEditorUi,
    );
    expect(bindingEditorProjection?.bindingEditor.config.mode).toBe("connection-config-key");
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
    expect(projected.resolvedBindingEditorUi).toBeUndefined();
  });

  it("projects binding editor UI for github targets with valid config", () => {
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
    const bindingEditorProjection = parseIntegrationBindingEditorUiProjection(
      projected.resolvedBindingEditorUi,
    );
    expect(bindingEditorProjection?.bindingEditor.kind).toBe("git");
  });
});
