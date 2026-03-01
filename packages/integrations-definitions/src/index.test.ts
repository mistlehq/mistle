import { describe, expect, it } from "vitest";

import { createIntegrationRegistry, listIntegrationDefinitions } from "./index.js";

describe("integrations-definitions index", () => {
  it("registers openai and github definitions in a registry", () => {
    const registry = createIntegrationRegistry();
    const openAiDefinition = registry.getDefinition({
      familyId: "openai",
      variantId: "openai-default",
    });
    const githubCloudDefinition = registry.getDefinition({
      familyId: "github",
      variantId: "github-cloud",
    });
    const githubEnterpriseServerDefinition = registry.getDefinition({
      familyId: "github",
      variantId: "github-enterprise-server",
    });

    expect(openAiDefinition?.displayName).toBe("OpenAI");
    expect(openAiDefinition?.kind).toBe("agent");
    expect(openAiDefinition?.userConfigSlots.map((slot) => slot.key)).toEqual([
      "codex_config",
      "openai_model",
      "openai_reasoning_effort",
    ]);
    expect(githubCloudDefinition).toMatchObject({
      familyId: "github",
      variantId: "github-cloud",
      kind: "git",
      displayName: "GitHub",
    });
    expect(githubEnterpriseServerDefinition).toMatchObject({
      familyId: "github",
      variantId: "github-enterprise-server",
      kind: "git",
      displayName: "GitHub Enterprise Server",
    });
  });

  it("lists registered definitions", () => {
    const definitions = listIntegrationDefinitions();

    expect(definitions).toHaveLength(3);
    expect(
      definitions.map((definition) => `${definition.familyId}::${definition.variantId}`),
    ).toEqual([
      "github::github-cloud",
      "github::github-enterprise-server",
      "openai::openai-default",
    ]);
  });
});
