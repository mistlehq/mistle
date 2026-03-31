import { describe, expect, it } from "vitest";

import {
  createDefinitionsBundle,
  createIntegrationRegistry,
  listIntegrationDefinitions,
} from "./index.js";

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
      connectionMethods: [
        {
          id: "atlassian-personal-api-token",
          label: "Personal API token",
          kind: "form",
          secretFields: [{ name: "apiKey", label: "Personal API token", inputType: "password" }],
        },
        {
          id: "atlassian-service-account-api-token",
          label: "Service account API token",
          kind: "form",
          secretFields: [
            { name: "apiKey", label: "Service account API token", inputType: "password" },
          ],
        },
        {
          id: "atlassian-service-account-oauth-client-credentials",
          label: "Service account OAuth client credentials",
          kind: "form",
          secretFields: [
            {
              name: "clientSecret",
              label: "Client secret",
              inputType: "password",
            },
          ],
        },
      ],
    });
    expect(openAiDefinition?.displayName).toBe("OpenAI");
    expect(openAiDefinition?.kind).toBe("agent");
    expect(githubCloudDefinition).toMatchObject({
      familyId: "github",
      variantId: "github-cloud",
      kind: "git",
      displayName: "GitHub",
      connectionMethods: [
        {
          id: "api-key",
          label: "API key",
          kind: "form",
          secretFields: [{ name: "apiKey", label: "API key", inputType: "password" }],
        },
        {
          id: "github-app-installation",
          label: "GitHub App installation",
          kind: "redirect",
        },
      ],
    });
    expect(githubCloudDefinition?.redirectHandler).toBeDefined();
    expect(githubCloudDefinition?.supportedWebhookEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "github.issue_comment.created",
          providerEventType: "issue_comment",
          displayName: "Issue comment created",
          category: "Issues",
          parameters: expect.arrayContaining([
            expect.objectContaining({
              id: "explicitInvocation",
              kind: "string",
              payloadPath: ["comment", "body"],
              matchMode: "contains_token",
              defaultValue: "@mistlebot",
              defaultEnabled: true,
              controlVariant: "explicit-invocation",
            }),
          ]),
        }),
        expect.objectContaining({
          eventType: "github.pull_request_review.submitted",
          providerEventType: "pull_request_review",
          displayName: "Pull request review submitted",
          category: "Pull requests",
          parameters: expect.arrayContaining([
            expect.objectContaining({
              id: "explicitInvocation",
              kind: "string",
              payloadPath: ["review", "body"],
              matchMode: "contains_token",
              defaultValue: "@mistlebot",
              defaultEnabled: true,
              controlVariant: "explicit-invocation",
            }),
          ]),
        }),
      ]),
    );
    expect(
      githubCloudDefinition?.credentialResolvers?.custom?.github_app_installation_token,
    ).toBeDefined();
    expect(githubEnterpriseServerDefinition).toMatchObject({
      familyId: "github",
      variantId: "github-enterprise-server",
      kind: "git",
      displayName: "GitHub Enterprise Server",
      connectionMethods: [
        {
          id: "api-key",
          label: "API key",
          kind: "form",
          secretFields: [{ name: "apiKey", label: "API key", inputType: "password" }],
        },
        {
          id: "github-app-installation",
          label: "GitHub App installation",
          kind: "redirect",
        },
      ],
    });
    expect(githubEnterpriseServerDefinition?.redirectHandler).toBeDefined();
    expect(githubEnterpriseServerDefinition?.supportedWebhookEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "github.issue_comment.created",
          providerEventType: "issue_comment",
          displayName: "Issue comment created",
          category: "Issues",
        }),
      ]),
    );
    expect(
      githubEnterpriseServerDefinition?.credentialResolvers?.custom?.github_app_installation_token,
    ).toBeDefined();
    expect(linearDefinition).toMatchObject({
      familyId: "linear",
      variantId: "linear-default",
      kind: "connector",
      displayName: "Linear",
      connectionMethods: [
        {
          id: "api-key",
          label: "API key",
          kind: "form",
          secretFields: [{ name: "apiKey", label: "API key", inputType: "password" }],
        },
      ],
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

  it("builds the integration definitions bundle with an agent runtime registry", () => {
    const definitions = createDefinitionsBundle();

    expect(
      definitions.integrationRegistry.getDefinition({
        familyId: "openai",
        variantId: "openai-default",
      }),
    ).toBeDefined();
    expect(definitions.agentRuntimeRegistry.listRuntimes()).toHaveLength(1);
    expect(definitions.agentRuntimeRegistry.listRuntimes()[0]).toMatchObject({
      runtimeId: "codex",
      displayName: "Codex",
    });
  });
});
