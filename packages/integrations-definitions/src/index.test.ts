import { describe, expect, it } from "vitest";

import { createIntegrationRegistry, listIntegrationDefinitions } from "./index.js";

describe("integrations-definitions index", () => {
  it("registers built-in integration definitions in a registry", () => {
    const registry = createIntegrationRegistry();
    const atlassianDefinition = registry.getDefinition({
      familyId: "atlassian",
      variantId: "atlassian-default",
    });
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
    const linearDefinition = registry.getDefinition({
      familyId: "linear",
      variantId: "linear-default",
    });

    expect(atlassianDefinition).toMatchObject({
      familyId: "atlassian",
      variantId: "atlassian-default",
      kind: "connector",
      displayName: "Atlassian",
      supportedAuthSchemes: ["api-key"],
    });
    expect(atlassianDefinition?.mcp).toBeDefined();
    expect(openAiDefinition?.displayName).toBe("OpenAI");
    expect(openAiDefinition?.kind).toBe("agent");
    expect(githubCloudDefinition).toMatchObject({
      familyId: "github",
      variantId: "github-cloud",
      kind: "git",
      displayName: "GitHub",
      supportedAuthSchemes: ["api-key", "oauth"],
    });
    expect(githubCloudDefinition?.authHandlers?.oauth).toBeDefined();
    expect(
      githubCloudDefinition?.credentialResolvers?.custom?.github_app_installation_token,
    ).toBeDefined();
    expect(githubEnterpriseServerDefinition).toMatchObject({
      familyId: "github",
      variantId: "github-enterprise-server",
      kind: "git",
      displayName: "GitHub Enterprise Server",
      supportedAuthSchemes: ["api-key", "oauth"],
    });
    expect(githubEnterpriseServerDefinition?.authHandlers?.oauth).toBeDefined();
    expect(
      githubEnterpriseServerDefinition?.credentialResolvers?.custom?.github_app_installation_token,
    ).toBeDefined();
    expect(linearDefinition).toMatchObject({
      familyId: "linear",
      variantId: "linear-default",
      kind: "connector",
      displayName: "Linear",
      supportedAuthSchemes: ["api-key"],
    });
    expect(linearDefinition?.mcp).toBeDefined();
  });

  it("lists registered definitions", () => {
    const definitions = listIntegrationDefinitions();

    expect(definitions).toHaveLength(5);
    expect(
      definitions.map((definition) => `${definition.familyId}::${definition.variantId}`),
    ).toEqual([
      "atlassian::atlassian-default",
      "github::github-cloud",
      "github::github-enterprise-server",
      "linear::linear-default",
      "openai::openai-default",
    ]);
  });
});
