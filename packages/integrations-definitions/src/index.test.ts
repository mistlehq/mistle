import { describe, expect, it } from "vitest";

import { createIntegrationRegistry, listIntegrationDefinitions } from "./index.js";

describe("integrations-definitions index", () => {
  it("registers openai definition in a registry", () => {
    const registry = createIntegrationRegistry();
    const definition = registry.getDefinition({
      familyId: "openai",
      variantId: "openai-api-key",
    });

    expect(definition?.displayName).toBe("OpenAI");
    expect(definition?.kind).toBe("agent");
  });

  it("lists registered definitions", () => {
    const definitions = listIntegrationDefinitions();

    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      familyId: "openai",
      variantId: "openai-api-key",
    });
  });
});
