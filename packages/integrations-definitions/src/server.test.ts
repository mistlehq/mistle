import { describe, expect, it } from "vitest";

import {
  createDefinitionsBundle,
  createIntegrationRegistry,
  listIntegrationDefinitions,
} from "./server.js";

describe("integrations-definitions server", () => {
  it("registers built-in server integration definitions in a registry", () => {
    const registry = createIntegrationRegistry();
    const jiraDefinition = registry.getDefinition({
      familyId: "jira",
      variantId: "jira-default",
    });
    const githubCloudDefinition = registry.getDefinition({
      familyId: "github",
      variantId: "github-cloud",
    });
    const githubEnterpriseServerDefinition = registry.getDefinition({
      familyId: "github",
      variantId: "github-enterprise-server",
    });
    const slackDefinition = registry.getDefinition({
      familyId: "slack",
      variantId: "slack-default",
    });

    expect(jiraDefinition?.webhookSource).toMatchObject({
      ownerScope: "connection",
      routingStrategy: "path",
      lifecycle: "managed",
    });
    expect(jiraDefinition?.webhookHandler).toBeDefined();
    expect(githubCloudDefinition?.redirectHandler).toBeDefined();
    expect(githubCloudDefinition?.webhookHandler).toBeDefined();
    expect(githubCloudDefinition?.webhookSource).toMatchObject({
      ownerScope: "target",
      routingStrategy: "payload",
      lifecycle: "implicit",
    });
    expect(
      githubCloudDefinition?.credentialResolvers?.custom?.github_app_installation_token,
    ).toBeDefined();
    expect(githubCloudDefinition?.resourceDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "repository",
          bindingField: "repositories",
        }),
      ]),
    );
    expect(githubEnterpriseServerDefinition?.redirectHandler).toBeDefined();
    expect(githubEnterpriseServerDefinition?.webhookHandler).toBeDefined();
    expect(githubEnterpriseServerDefinition?.webhookSource).toMatchObject({
      ownerScope: "target",
      routingStrategy: "payload",
      lifecycle: "implicit",
    });
    expect(
      githubEnterpriseServerDefinition?.credentialResolvers?.custom?.github_app_installation_token,
    ).toBeDefined();
    expect(githubEnterpriseServerDefinition?.resourceDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "repository",
          bindingField: "repositories",
        }),
      ]),
    );
    expect(slackDefinition?.webhookHandler).toBeDefined();
    expect(slackDefinition?.webhookSource).toMatchObject({
      ownerScope: "connection",
      routingStrategy: "path",
      lifecycle: "implicit",
    });
  });

  it("lists registered server definitions", () => {
    const definitions = listIntegrationDefinitions();

    expect(definitions).toHaveLength(6);
  });

  it("builds the server definitions bundle with an agent runtime registry", () => {
    const definitions = createDefinitionsBundle();

    expect(
      definitions.integrationRegistry.getDefinition({
        familyId: "openai",
        variantId: "openai-default",
      }),
    ).toBeDefined();
    expect(definitions.agentRuntimeRegistry.listRuntimes()).toHaveLength(1);
  });
});
