import { describe, expect, it } from "vitest";

import { createOpenAiRawBindingCapabilities } from "./model-capabilities.js";
import { projectOpenAiTargetUi } from "./project-target-ui.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";
import { OpenAiTargetUiProjectionSchema, parseOpenAiTargetUiProjection } from "./ui-contract.js";

describe("projectOpenAiTargetUi", () => {
  it("projects target capabilities into UI payload with canonical reasoning values", () => {
    const targetConfig = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com",
      binding_capabilities: createOpenAiRawBindingCapabilities(),
    });

    const projection = projectOpenAiTargetUi({
      targetConfig,
    });

    expect(projection.openaiAgent.runtime).toBe("codex-cli");
    expect(projection.openaiAgent.byAuthScheme["api-key"].models).toContain("gpt-5.3-codex");
    expect(
      projection.openaiAgent.byAuthScheme["api-key"].allowedReasoningByModel["gpt-5.1-codex-mini"],
    ).toEqual(["medium", "high"]);
    expect(projection.openaiAgent.byAuthScheme["api-key"].reasoningLabels.xhigh).toBe("Extra High");
  });

  it("validates the projected shape with the projection schema", () => {
    const targetConfig = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com",
      binding_capabilities: createOpenAiRawBindingCapabilities(),
    });

    const projection = projectOpenAiTargetUi({
      targetConfig,
    });

    expect(OpenAiTargetUiProjectionSchema.parse(projection)).toEqual(projection);
    expect(parseOpenAiTargetUiProjection(projection)).toEqual(projection);
    expect(parseOpenAiTargetUiProjection({})).toBeUndefined();
  });
});
