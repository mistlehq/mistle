import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import { parseIntegrationBindingEditorUiProjection } from "@mistle/integrations-definitions/ui";
import { describe, expect, it } from "vitest";

import { projectTargetUi } from "./project-target-ui.js";

describe("project-target-ui", () => {
  it("projects OpenAI binding editor UI for valid config", () => {
    const projected = projectTargetUi({
      familyId: "openai",
      variantId: "openai-default",
      config: {
        api_base_url: "https://api.openai.com",
        binding_capabilities: createOpenAiRawBindingCapabilities(),
      },
    });

    expect(projected.targetHealth.configStatus).toBe("valid");
    const bindingEditorProjection = parseIntegrationBindingEditorUiProjection(
      projected.resolvedBindingEditorUi,
    );
    expect(bindingEditorProjection?.bindingEditor.config.mode).toBe("connection-config-key");
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
    expect(projected.targetHealth.reason).toBe("invalid-config");
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
    const bindingEditorProjection = parseIntegrationBindingEditorUiProjection(
      projected.resolvedBindingEditorUi,
    );
    expect(bindingEditorProjection?.bindingEditor.kind).toBe("git");
  });
});
