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
    const agentMailDefinition = registry.getDefinition({
      familyId: "agentmail",
      variantId: "agentmail-mcp",
    });
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
    const googleWorkspaceDefinition = registry.getDefinition({
      familyId: "google-workspace",
      variantId: "google-workspace-mcp",
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
    const metaAdsDefinition = registry.getDefinition({
      familyId: "metaads",
      variantId: "metaads-default",
    });
    const notionDefinition = registry.getDefinition({
      familyId: "notion",
      variantId: "notion-mcp",
    });
    const openCodeGoDefinition = registry.getDefinition({
      familyId: "opencode",
      variantId: "opencode-go",
    });
    const openRouterDefinition = registry.getDefinition({
      familyId: "openrouter",
      variantId: "openrouter-default",
    });
    const planetscaleDefinition = registry.getDefinition({
      familyId: "planetscale",
      variantId: "planetscale-mcp",
    });
    const postHogDefinition = registry.getDefinition({
      familyId: "posthog",
      variantId: "posthog-mcp",
    });
    const railwayDefinition = registry.getDefinition({
      familyId: "railway",
      variantId: "railway-mcp",
    });
    const renderDefinition = registry.getDefinition({
      familyId: "render",
      variantId: "render-mcp",
    });
    const resendDefinition = registry.getDefinition({
      familyId: "resend",
      variantId: "resend-mcp",
    });
    const wasenderApiDefinition = registry.getDefinition({
      familyId: "wasenderapi",
      variantId: "wasenderapi-mcp",
    });
    const whapiDefinition = registry.getDefinition({
      familyId: "whapi",
      variantId: "whapi-mcp",
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

    expect(agentMailDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(agentMailDefinition?.webhookHandler).toBeUndefined();
    expect(agentMailDefinition?.webhookSource).toBeUndefined();
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
    expect(openRouterDefinition).toMatchObject({
      familyId: "openrouter",
      variantId: "openrouter-default",
      kind: "agent",
      displayName: "OpenRouter",
      allowedRuntimeIds: ["opencode", "pi"],
    });
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
    expect(metaAdsDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(metaAdsDefinition?.webhookHandler).toBeUndefined();
    expect(metaAdsDefinition?.webhookSource).toBeUndefined();
    expect(expoDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(expoDefinition?.webhookHandler).toBeUndefined();
    expect(expoDefinition?.webhookSource).toBeUndefined();
    expect(cloudflareDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(cloudflareDefinition?.webhookHandler).toBeUndefined();
    expect(cloudflareDefinition?.webhookSource).toBeUndefined();
    expect(gcpDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(gcpDefinition?.webhookHandler).toBeUndefined();
    expect(gcpDefinition?.webhookSource).toBeUndefined();
    expect(googleWorkspaceDefinition).toMatchObject({
      familyId: "google-workspace",
      variantId: "google-workspace-mcp",
      kind: "connector",
      displayName: "Google Workspace",
    });
    expect(googleWorkspaceDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(googleWorkspaceDefinition?.authorizationRevocation).toBeDefined();
    expect(googleWorkspaceDefinition?.credentialResolvers?.default).toBeDefined();
    expect(googleWorkspaceDefinition?.mcp).toBeDefined();
    expect(planetscaleDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(planetscaleDefinition?.webhookHandler).toBeUndefined();
    expect(planetscaleDefinition?.webhookSource).toBeUndefined();
    expect(postHogDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(postHogDefinition?.webhookHandler).toBeUndefined();
    expect(postHogDefinition?.webhookSource).toBeUndefined();
    expect(railwayDefinition?.oauth2AuthorizationCode).toBeDefined();
    expect(railwayDefinition?.webhookHandler).toBeUndefined();
    expect(railwayDefinition?.webhookSource).toBeUndefined();
    expect(renderDefinition).toMatchObject({
      familyId: "render",
      variantId: "render-mcp",
      kind: "connector",
      displayName: "Render",
      logoKey: "render",
      connectionMethods: [
        {
          id: "api-key",
          label: "API key",
          kind: "form",
        },
      ],
    });
    expect(renderDefinition?.mcp).toBeDefined();
    expect(renderDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(renderDefinition?.webhookHandler).toBeUndefined();
    expect(renderDefinition?.webhookSource).toBeUndefined();
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
    expect(wasenderApiDefinition).toMatchObject({
      familyId: "wasenderapi",
      variantId: "wasenderapi-mcp",
      kind: "connector",
      displayName: "WasenderAPI",
      logoKey: "wasenderapi",
      connectionMethods: [
        {
          id: "api-key",
          label: "Personal access token",
          kind: "form",
          createBehavior: "draft-then-setup",
        },
      ],
    });
    expect(wasenderApiDefinition?.mcp).toBeDefined();
    expect(wasenderApiDefinition?.providerConfigurationSetup).toMatchObject({
      flows: [
        {
          methodId: "api-key",
          requiresWebhookCallbackUrl: true,
          routeSegment: "provider-configuration",
        },
      ],
    });
    expect(wasenderApiDefinition?.webhookHandler).toBeDefined();
    expect(wasenderApiDefinition?.webhookSource).toBeDefined();
    const wasenderApiConnectionMethod = wasenderApiDefinition?.connectionMethods.find(
      (method) => method.id === "api-key",
    );
    expect(
      wasenderApiConnectionMethod?.kind === "form"
        ? wasenderApiConnectionMethod.setupFlow?.setupPane
        : undefined,
    ).toEqual({
      kind: "provider-configuration",
    });
    expect(whapiDefinition).toMatchObject({
      familyId: "whapi",
      variantId: "whapi-mcp",
      kind: "connector",
      displayName: "Whapi",
      logoKey: "whapi",
      connectionMethods: [
        {
          id: "api-key",
          label: "API token",
          kind: "form",
        },
      ],
    });
    expect(whapiDefinition?.mcp).toBeDefined();
    expect(whapiDefinition?.providerConfigurationSetup).toMatchObject({
      flows: [
        {
          methodId: "api-key",
          requiresWebhookCallbackUrl: true,
          routeSegment: "provider-configuration",
        },
      ],
    });
    expect(whapiDefinition?.webhookHandler).toBeDefined();
    expect(whapiDefinition?.webhookSource).toBeDefined();
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
      expect.objectContaining({
        kind: "user",
        bindingField: "users",
      }),
      expect.objectContaining({
        kind: "user_group",
        bindingField: "userGroups",
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
      {
        eventType: "slack:team_join",
        resourceKinds: ["user"],
      },
      {
        eventType: "slack:user_change",
        resourceKinds: ["user"],
      },
      {
        eventType: "slack:subteam_created",
        resourceKinds: ["user_group"],
      },
      {
        eventType: "slack:subteam_updated",
        resourceKinds: ["user_group"],
      },
    ]);
    expect(typeof slackDefinition?.listConnectionResources).toBe("function");
  });

  it("lists registered server definitions", () => {
    const definitions = listIntegrationDefinitions();

    expect(definitions).toHaveLength(42);
    expect(
      definitions.map((definition) => `${definition.familyId}::${definition.variantId}`),
    ).toEqual(
      expect.arrayContaining([
        "agentmail::agentmail-mcp",
        "autumn::autumn-mcp",
        "bugsnag::bugsnag-mcp",
        "deepseek::deepseek-default",
        "expo::expo-mcp",
        "fireworks::fireworks-default",
        "google-analytics::google-analytics-mcp",
        "google-workspace::google-workspace-mcp",
        "inception::inception-default",
        "kimi::kimi-default",
        "metaads::metaads-default",
        "minimax::minimax-default",
        "notion::notion-mcp",
        "openrouter::openrouter-default",
        "posthog::posthog-mcp",
        "railway::railway-mcp",
        "render::render-mcp",
        "resend::resend-mcp",
        "shopify::shopify-default",
        "stripe::stripe-mcp",
        "supabase::supabase-mcp",
        "wasenderapi::wasenderapi-mcp",
        "whapi::whapi-mcp",
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
        runtimeId: "claude-code",
        displayName: "Claude Code",
      },
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
