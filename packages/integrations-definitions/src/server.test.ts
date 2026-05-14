import { describe, expect, it } from "vitest";

import { createAgentRuntimeServerRegistry } from "./registry/agent-runtimes.server.js";
import {
  createDefinitionsBundle,
  createIntegrationRegistry,
  listIntegrationDefinitions,
} from "./server.js";

describe("integrations-definitions server", () => {
  it("exposes conversation title generation for every server agent runtime provider", () => {
    const registry = createAgentRuntimeServerRegistry();

    const missingTitleGeneration = registry
      .listRuntimes()
      .filter((runtime) => {
        const provider = runtime.createConversationProvider?.();
        return typeof provider?.generateConversationTitle !== "function";
      })
      .map((runtime) => runtime.runtimeId);

    expect(missingTitleGeneration).toEqual([]);
  });

  it("registers built-in server integration definitions in a registry", () => {
    const registry = createIntegrationRegistry();
    const anthropicDefinition = registry.getDefinition({
      familyId: "anthropic",
      variantId: "anthropic-default",
    });
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
    const e2bSandboxRuntimeDefinition = registry.getDefinition({
      familyId: "e2b",
      variantId: "e2b-default",
    });
    const githubEnterpriseServerDefinition = registry.getDefinition({
      familyId: "github",
      variantId: "github-enterprise-server",
    });
    const openCodeGoDefinition = registry.getDefinition({
      familyId: "opencode",
      variantId: "opencode-go",
    });
    const planetscaleDefinition = registry.getDefinition({
      familyId: "planetscale",
      variantId: "planetscale-mcp",
    });
    const sentryDefinition = registry.getDefinition({
      familyId: "sentry",
      variantId: "sentry-mcp",
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
    expect(typeof githubCloudDefinition?.identityLinking?.supportsConnection).toBe("function");
    expect(typeof githubCloudDefinition?.identityLinking?.startAuthorization).toBe("function");
    expect(typeof githubCloudDefinition?.identityLinking?.completeAuthorization).toBe("function");
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
    expect(anthropicDefinition?.kind).toBe("agent");
    expect(openCodeGoDefinition?.kind).toBe("agent");
    expect(
      githubEnterpriseServerDefinition?.credentialResolvers?.custom?.github_app_installation_token,
    ).toBeDefined();
    expect(awsDefinition?.credentialResolvers?.custom?.["assume-role-session"]).toBeDefined();
    expect(e2bSandboxRuntimeDefinition).toMatchObject({
      familyId: "e2b",
      variantId: "e2b-default",
      kind: "sandbox",
      sandboxRuntime: {
        providerId: "e2b",
      },
    });
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
    expect(sentryDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(sentryDefinition?.webhookHandler).toBeUndefined();
    expect(sentryDefinition?.webhookSource).toBeUndefined();
    expect(signozDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(signozDefinition?.webhookHandler).toBeUndefined();
    expect(signozDefinition?.webhookSource).toBeUndefined();
    expect(slackDefinition?.webhookHandler).toBeDefined();
    expect(slackDefinition?.webhookSource).toMatchObject({
      lifecycle: "implicit",
    });
    expect(slackDefinition?.resourceDefinitions).toEqual([
      expect.objectContaining({
        kind: "channel",
        bindingField: "channels",
      }),
    ]);
    expect(slackDefinition?.resourceSyncTriggers).toEqual([
      {
        eventType: "slack:channel_created",
        resourceKinds: ["channel"],
      },
      {
        eventType: "slack:channel_archive",
        resourceKinds: ["channel"],
      },
      {
        eventType: "slack:channel_unarchive",
        resourceKinds: ["channel"],
      },
      {
        eventType: "slack:channel_rename",
        resourceKinds: ["channel"],
      },
      {
        eventType: "slack:group_archive",
        resourceKinds: ["channel"],
      },
      {
        eventType: "slack:group_unarchive",
        resourceKinds: ["channel"],
      },
      {
        eventType: "slack:group_rename",
        resourceKinds: ["channel"],
      },
    ]);
    expect(typeof slackDefinition?.listConnectionResources).toBe("function");
  });

  it("lists registered server definitions", () => {
    const definitions = listIntegrationDefinitions();

    expect(definitions).toHaveLength(14);
  });

  it("builds the server definitions bundle with an agent runtime registry", () => {
    const definitions = createDefinitionsBundle();

    expect(
      definitions.integrationRegistry.getDefinition({
        familyId: "openai",
        variantId: "openai-default",
      }),
    ).toBeDefined();
    expect(definitions.agentRuntimeRegistry.listRuntimes()).toHaveLength(2);
  });
});
