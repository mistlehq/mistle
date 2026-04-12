import { describe, expect, it } from "vitest";

import {
  createDefinitionsBundle,
  createIntegrationRegistry,
  listIntegrationDefinitions,
} from "./server.js";

describe("integrations-definitions server", () => {
  it("registers built-in server integration definitions in a registry", () => {
    const registry = createIntegrationRegistry();
    const awsDefinition = registry.getDefinition({
      familyId: "aws",
      variantId: "aws-cli-default",
    });
    const datadogDefinition = registry.getDefinition({
      familyId: "datadog",
      variantId: "datadog-default",
    });
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
    const planetscaleDefinition = registry.getDefinition({
      familyId: "planetscale",
      variantId: "planetscale-mcp",
    });
    const signozDefinition = registry.getDefinition({
      familyId: "signoz",
      variantId: "signoz-mcp",
    });
    const slackDefinition = registry.getDefinition({
      familyId: "slack",
      variantId: "slack-default",
    });

    expect(jiraDefinition?.webhookSource).toMatchObject({
      lifecycle: "managed",
    });
    expect(jiraDefinition?.webhookHandler).toBeDefined();
    expect(githubCloudDefinition?.webhookHandler).toBeDefined();
    expect(githubCloudDefinition?.webhookSource).toMatchObject({
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
    expect(githubEnterpriseServerDefinition?.webhookHandler).toBeDefined();
    expect(githubEnterpriseServerDefinition?.webhookSource).toMatchObject({
      lifecycle: "implicit",
    });
    expect(
      githubEnterpriseServerDefinition?.credentialResolvers?.custom?.github_app_installation_token,
    ).toBeDefined();
    expect(awsDefinition?.credentialResolvers?.custom?.["assume-role-session"]).toBeDefined();
    expect(awsDefinition?.webhookHandler).toBeUndefined();
    expect(awsDefinition?.webhookSource).toBeUndefined();
    expect(githubEnterpriseServerDefinition?.resourceDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "repository",
          bindingField: "repositories",
        }),
      ]),
    );
    expect(datadogDefinition?.webhookHandler).toBeUndefined();
    expect(datadogDefinition?.webhookSource).toBeUndefined();
    expect(datadogDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(planetscaleDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(planetscaleDefinition?.webhookHandler).toBeUndefined();
    expect(planetscaleDefinition?.webhookSource).toBeUndefined();
    expect(signozDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(signozDefinition?.webhookHandler).toBeUndefined();
    expect(signozDefinition?.webhookSource).toBeUndefined();
    expect(slackDefinition?.webhookHandler).toBeDefined();
    expect(slackDefinition?.webhookSource).toMatchObject({
      lifecycle: "implicit",
    });
  });

  it("lists registered server definitions", () => {
    const definitions = listIntegrationDefinitions();

    expect(definitions).toHaveLength(10);
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
