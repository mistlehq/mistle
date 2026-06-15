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
    const bugSnagDefinition = registry.getDefinition({
      familyId: "bugsnag",
      variantId: "bugsnag-mcp",
    });
    const datadogDefinition = registry.getDefinition({
      familyId: "datadog",
      variantId: "datadog-default",
    });
    const expoDefinition = registry.getDefinition({
      familyId: "expo",
      variantId: "expo-mcp",
    });
    const cloudflareDefinition = registry.getDefinition({
      familyId: "cloudflare",
      variantId: "cloudflare-mcp",
    });
    const gcpDefinition = registry.getDefinition({
      familyId: "gcp",
      variantId: "gcp-mcp",
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
    const modalSandboxRuntimeDefinition = registry.getDefinition({
      familyId: "modal",
      variantId: "modal-default",
    });
    const tensorlakeSandboxRuntimeDefinition = registry.getDefinition({
      familyId: "tensorlake",
      variantId: "tensorlake-default",
    });
    const openComputerSandboxRuntimeDefinition = registry.getDefinition({
      familyId: "opencomputer",
      variantId: "opencomputer-default",
    });
    const githubEnterpriseServerDefinition = registry.getDefinition({
      familyId: "github",
      variantId: "github-enterprise-server",
    });
    const linearDefinition = registry.getDefinition({
      familyId: "linear",
      variantId: "linear-default",
    });
    const notionDefinition = registry.getDefinition({
      familyId: "notion",
      variantId: "notion-mcp",
    });
    const openCodeGoDefinition = registry.getDefinition({
      familyId: "opencode",
      variantId: "opencode-go",
    });
    const planetscaleDefinition = registry.getDefinition({
      familyId: "planetscale",
      variantId: "planetscale-mcp",
    });
    const postHogDefinition = registry.getDefinition({
      familyId: "posthog",
      variantId: "posthog-mcp",
    });
    const resendDefinition = registry.getDefinition({
      familyId: "resend",
      variantId: "resend-mcp",
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
        expect.objectContaining({
          kind: "team",
          bindingField: "teams",
        }),
        expect.objectContaining({
          kind: "bot",
          bindingField: "bots",
        }),
      ]),
    );
    expect(githubCloudDefinition?.resourceSyncTriggers).toEqual([
      {
        eventType: "github.installation_repositories.added",
        resourceKinds: ["repository", "user"],
      },
      {
        eventType: "github.installation_repositories.removed",
        resourceKinds: ["repository", "user"],
      },
      {
        eventType: "github.member.added",
        resourceKinds: ["user"],
      },
      {
        eventType: "github.member.edited",
        resourceKinds: ["user"],
      },
      {
        eventType: "github.member.removed",
        resourceKinds: ["user"],
      },
      {
        eventType: "github.membership.added",
        resourceKinds: ["user"],
      },
      {
        eventType: "github.membership.removed",
        resourceKinds: ["user"],
      },
      {
        eventType: "github.organization.member_added",
        resourceKinds: ["user"],
      },
      {
        eventType: "github.organization.member_removed",
        resourceKinds: ["user"],
      },
      {
        eventType: "github.team.added_to_repository",
        resourceKinds: ["user"],
      },
      {
        eventType: "github.team.removed_from_repository",
        resourceKinds: ["user"],
      },
    ]);
    expect(githubEnterpriseServerDefinition?.webhookHandler).toBeDefined();
    expect(githubEnterpriseServerDefinition?.webhookSource).toMatchObject({
      lifecycle: "implicit",
    });
    expect(linearDefinition?.webhookHandler).toBeDefined();
    expect(linearDefinition?.webhookSource).toMatchObject({
      lifecycle: "managed",
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
    expect(modalSandboxRuntimeDefinition).toMatchObject({
      familyId: "modal",
      variantId: "modal-default",
      kind: "sandbox",
      sandboxRuntime: {
        providerId: "modal",
      },
      connectionMethods: [
        {
          id: "api-key",
          label: "Token",
          kind: "form",
        },
      ],
    });
    expect(tensorlakeSandboxRuntimeDefinition).toMatchObject({
      familyId: "tensorlake",
      variantId: "tensorlake-default",
      kind: "sandbox",
      sandboxRuntime: {
        providerId: "tensorlake",
      },
    });
    expect(openComputerSandboxRuntimeDefinition).toMatchObject({
      familyId: "opencomputer",
      variantId: "opencomputer-default",
      kind: "sandbox",
      sandboxRuntime: {
        providerId: "opencomputer",
      },
      connectionMethods: [
        {
          id: "api-key",
          label: "API key",
          kind: "form",
        },
      ],
    });
    expect(awsDefinition?.webhookHandler).toBeUndefined();
    expect(awsDefinition?.webhookSource).toBeUndefined();
    expect(bugSnagDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(bugSnagDefinition?.webhookHandler).toBeUndefined();
    expect(bugSnagDefinition?.webhookSource).toBeUndefined();
    expect(bugSnagDefinition?.resourceDefinitions).toBeUndefined();
    expect(bugSnagDefinition?.resourceSyncTriggers).toBeUndefined();
    expect(githubEnterpriseServerDefinition?.resourceDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "repository",
          bindingField: "repositories",
        }),
        expect.objectContaining({
          kind: "team",
          bindingField: "teams",
        }),
        expect.objectContaining({
          kind: "bot",
          bindingField: "bots",
        }),
      ]),
    );
    expect(datadogDefinition?.webhookHandler).toBeUndefined();
    expect(datadogDefinition?.webhookSource).toBeUndefined();
    expect(datadogDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(expoDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(expoDefinition?.webhookHandler).toBeUndefined();
    expect(expoDefinition?.webhookSource).toBeUndefined();
    expect(cloudflareDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(cloudflareDefinition?.webhookHandler).toBeUndefined();
    expect(cloudflareDefinition?.webhookSource).toBeUndefined();
    expect(gcpDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(gcpDefinition?.webhookHandler).toBeUndefined();
    expect(gcpDefinition?.webhookSource).toBeUndefined();
    expect(planetscaleDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(planetscaleDefinition?.webhookHandler).toBeUndefined();
    expect(planetscaleDefinition?.webhookSource).toBeUndefined();
    expect(postHogDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(postHogDefinition?.webhookHandler).toBeUndefined();
    expect(postHogDefinition?.webhookSource).toBeUndefined();
    expect(resendDefinition).toMatchObject({
      familyId: "resend",
      variantId: "resend-mcp",
      kind: "connector",
      displayName: "Resend",
      logoKey: "resend",
      connectionMethods: [
        {
          id: "api-key",
          label: "API key",
          kind: "form",
        },
      ],
    });
    expect(resendDefinition?.mcp).toBeDefined();
    expect(resendDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(resendDefinition?.webhookHandler).toBeUndefined();
    expect(resendDefinition?.webhookSource).toBeUndefined();
    expect(notionDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(notionDefinition?.webhookHandler).toBeUndefined();
    expect(notionDefinition?.webhookSource).toBeUndefined();
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

    expect(definitions).toHaveLength(29);
    expect(
      definitions.map((definition) => `${definition.familyId}::${definition.variantId}`),
    ).toEqual(
      expect.arrayContaining([
        "bugsnag::bugsnag-mcp",
        "deepseek::deepseek-default",
        "expo::expo-mcp",
        "fireworks::fireworks-default",
        "inception::inception-default",
        "kimi::kimi-default",
        "minimax::minimax-default",
        "notion::notion-mcp",
        "posthog::posthog-mcp",
        "resend::resend-mcp",
        "zai::zai-coding-plan",
      ]),
    );
  });

  it("builds the server definitions bundle with an agent runtime registry", () => {
    const definitions = createDefinitionsBundle();

    expect(
      definitions.integrationRegistry.getDefinition({
        familyId: "openai",
        variantId: "openai-default",
      }),
    ).toBeDefined();
    expect(definitions.agentRuntimeRegistry.listRuntimes()).toMatchObject([
      {
        runtimeId: "codex",
        displayName: "Codex",
      },
      {
        runtimeId: "opencode",
        displayName: "OpenCode",
      },
      {
        runtimeId: "pi",
        displayName: "Pi",
      },
    ]);
  });
});
