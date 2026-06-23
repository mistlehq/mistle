import { describe, expect, it } from "vitest";

import {
  createDefinitionsBundle,
  createIntegrationRegistry,
  listIntegrationDefinitions,
} from "./index.js";

describe("integrations-definitions index", () => {
  it("registers built-in browser-safe integration definitions in a registry", () => {
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
    const deepSeekDefinition = registry.getDefinition({
      familyId: "deepseek",
      variantId: "deepseek-default",
    });
    const fireworksDefinition = registry.getDefinition({
      familyId: "fireworks",
      variantId: "fireworks-default",
    });
    const inceptionDefinition = registry.getDefinition({
      familyId: "inception",
      variantId: "inception-default",
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
    const kimiDefinition = registry.getDefinition({
      familyId: "kimi",
      variantId: "kimi-default",
    });
    const openAiDefinition = registry.getDefinition({
      familyId: "openai",
      variantId: "openai-default",
    });
    const openRouterDefinition = registry.getDefinition({
      familyId: "openrouter",
      variantId: "openrouter-default",
    });
    const miniMaxDefinition = registry.getDefinition({
      familyId: "minimax",
      variantId: "minimax-default",
    });
    const metaAdsDefinition = registry.getDefinition({
      familyId: "metaads",
      variantId: "metaads-default",
    });
    const zaiDefinition = registry.getDefinition({
      familyId: "zai",
      variantId: "zai-coding-plan",
    });
    const openCodeGoDefinition = registry.getDefinition({
      familyId: "opencode",
      variantId: "opencode-go",
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

    expect(agentMailDefinition).toMatchObject({
      familyId: "agentmail",
      variantId: "agentmail-mcp",
      kind: "connector",
      displayName: "AgentMail",
      logoKey: "agentmail",
      connectionMethods: [
        {
          id: "oauth2-authorization-code",
          label: "AgentMail OAuth",
          kind: "redirect",
          ui: {
            create: {
              submitLabel: "Connect AgentMail",
              helperText: "Authorize AgentMail hosted MCP access.",
            },
          },
        },
      ],
    });
    expect(agentMailDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(awsDefinition).toMatchObject({
      familyId: "aws",
      variantId: "aws-cli-default",
      kind: "connector",
      displayName: "AWS",
      connectionMethods: [
        {
          id: "aws-assume-role",
          label: "Access key + AssumeRole",
          kind: "form",
          secretFields: [
            {
              name: "secretAccessKey",
              label: "Secret access key",
              inputType: "password",
              slotKey: "aws.aws-cli-default.aws-assume-role.secret-access-key",
            },
          ],
        },
      ],
    });
    expect(awsDefinition?.credentialResolvers).toBeUndefined();
    expect(awsDefinition?.webhookHandler).toBeUndefined();
    expect(awsDefinition?.webhookSource).toBeUndefined();
    expect(bugSnagDefinition).toMatchObject({
      familyId: "bugsnag",
      variantId: "bugsnag-mcp",
      kind: "connector",
      displayName: "BugSnag",
      connectionMethods: [
        {
          id: "oauth2-authorization-code",
          label: "BugSnag OAuth",
          kind: "redirect",
          ui: {
            create: {
              submitLabel: "Connect BugSnag",
              helperText: "Authorize SmartBear hosted BugSnag MCP access.",
            },
          },
        },
      ],
    });
    expect(bugSnagDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(datadogDefinition).toMatchObject({
      familyId: "datadog",
      variantId: "datadog-default",
      kind: "connector",
      displayName: "Datadog",
      connectionMethods: [
        {
          id: "api-key",
          label: "API key + application key",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
              slotKey: "datadog.datadog-default.api-key.api-key",
            },
            {
              name: "applicationKey",
              label: "Application key",
              inputType: "password",
              slotKey: "datadog.datadog-default.api-key.application-key",
            },
          ],
        },
      ],
    });
    expect(datadogDefinition?.mcp).toBeDefined();
    expect(cloudflareDefinition).toMatchObject({
      familyId: "cloudflare",
      variantId: "cloudflare-mcp",
      kind: "connector",
      displayName: "Cloudflare",
      connectionMethods: [
        {
          id: "api-key",
          label: "API token",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "Cloudflare API token",
              inputType: "password",
              slotKey: "cloudflare.cloudflare-mcp.api-key.api-key",
            },
          ],
        },
      ],
    });
    expect(cloudflareDefinition?.mcp).toBeDefined();
    expect(gcpDefinition).toMatchObject({
      familyId: "gcp",
      variantId: "gcp-mcp",
      kind: "connector",
      displayName: "Google Cloud",
      connectionMethods: [
        {
          id: "oauth2-authorization-code",
          label: "Google OAuth",
          kind: "redirect",
          ui: {
            create: {
              submitLabel: "Connect Google Cloud",
              helperText: "Authorize Google Cloud access with your Google OAuth client.",
              showCallbackUrl: true,
            },
          },
        },
      ],
    });
    expect(gcpDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(googleWorkspaceDefinition).toMatchObject({
      familyId: "google-workspace",
      variantId: "google-workspace-mcp",
      kind: "connector",
      displayName: "Google Workspace",
      connectionMethods: [
        {
          id: "oauth2-authorization-code",
          label: "Google OAuth",
          kind: "redirect",
          ui: {
            create: {
              submitLabel: "Connect Google Workspace",
              helperText: "Authorize Google Workspace access with your Google OAuth client.",
              showCallbackUrl: true,
            },
          },
        },
        {
          id: "google-workspace-service-account-domain-wide-delegation",
          label: "Service account",
          kind: "form",
          secretFields: [
            {
              name: "serviceAccountKeyJson",
              label: "Service account JSON key",
              inputType: "textarea",
              secretType: "api_key",
              slotKey: "google-workspace.google-workspace-mcp.service-account-key-json",
            },
          ],
        },
      ],
    });
    expect(googleWorkspaceDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(googleWorkspaceDefinition?.credentialResolvers).toBeUndefined();
    expect(jiraDefinition).toMatchObject({
      familyId: "jira",
      variantId: "jira-default",
      kind: "connector",
      displayName: "Jira",
      connectionMethods: [
        {
          id: "jira-personal-api-token",
          label: "Personal API token",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "Personal API token",
              inputType: "password",
              slotKey: "jira.jira-default.jira-personal-api-token.api-key",
            },
          ],
        },
        {
          id: "jira-service-account-api-token",
          label: "Service account API token",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "Service account API token",
              inputType: "password",
              slotKey: "jira.jira-default.jira-service-account-api-token.api-key",
            },
          ],
        },
        {
          id: "jira-service-account-oauth-client-credentials",
          label: "Service account OAuth client credentials",
          kind: "form",
          secretFields: [
            {
              name: "clientSecret",
              label: "Client secret",
              inputType: "password",
              slotKey:
                "jira.jira-default.jira-service-account-oauth-client-credentials.client-secret",
            },
          ],
        },
      ],
    });
    expect(jiraDefinition?.webhookSource).toBeUndefined();
    expect(jiraDefinition?.webhookHandler).toBeUndefined();
    expect(jiraDefinition?.supportedWebhookEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "jira:issue_created",
          providerEventType: "jira:issue_created",
          displayName: "Issue created",
        }),
        expect.objectContaining({
          eventType: "comment_created",
          providerEventType: "comment_created",
          displayName: "Comment created",
        }),
      ]),
    );
    expect(anthropicDefinition).toMatchObject({
      familyId: "anthropic",
      variantId: "anthropic-default",
      kind: "agent",
      displayName: "Anthropic",
      allowedRuntimeIds: ["claude-code", "opencode", "pi"],
    });
    expect(openAiDefinition?.displayName).toBe("OpenAI");
    expect(openAiDefinition?.kind).toBe("agent");
    expect(openRouterDefinition).toMatchObject({
      familyId: "openrouter",
      variantId: "openrouter-default",
      kind: "agent",
      displayName: "OpenRouter",
      allowedRuntimeIds: ["opencode", "pi"],
    });
    expect(deepSeekDefinition).toMatchObject({
      familyId: "deepseek",
      variantId: "deepseek-default",
      kind: "agent",
      displayName: "DeepSeek",
      allowedRuntimeIds: ["opencode", "pi"],
    });
    expect(fireworksDefinition).toMatchObject({
      familyId: "fireworks",
      variantId: "fireworks-default",
      kind: "agent",
      displayName: "Fireworks AI",
      allowedRuntimeIds: ["opencode", "pi"],
    });
    expect(inceptionDefinition).toMatchObject({
      familyId: "inception",
      variantId: "inception-default",
      kind: "agent",
      displayName: "Inception Labs",
      allowedRuntimeIds: ["opencode", "pi"],
    });
    expect(kimiDefinition).toMatchObject({
      familyId: "kimi",
      variantId: "kimi-default",
      kind: "agent",
      displayName: "Kimi",
      allowedRuntimeIds: ["opencode", "pi"],
    });
    expect(miniMaxDefinition).toMatchObject({
      familyId: "minimax",
      variantId: "minimax-default",
      kind: "agent",
      displayName: "MiniMax",
      allowedRuntimeIds: ["opencode", "pi"],
    });
    expect(metaAdsDefinition).toMatchObject({
      familyId: "metaads",
      variantId: "metaads-default",
      kind: "connector",
      displayName: "Meta Ads",
      logoKey: "metaads",
      connectionMethods: [
        {
          id: "api-key",
          label: "Access token",
          kind: "form",
          secretFields: [
            {
              name: "accessToken",
              label: "Access token",
              inputType: "password",
              slotKey: "metaads.metaads-default.api-key.access-token",
            },
          ],
        },
      ],
    });
    expect(zaiDefinition).toMatchObject({
      familyId: "zai",
      variantId: "zai-coding-plan",
      kind: "agent",
      displayName: "Z.ai",
      allowedRuntimeIds: ["opencode", "pi"],
    });
    expect(openCodeGoDefinition).toMatchObject({
      familyId: "opencode",
      variantId: "opencode-go",
      kind: "agent",
      displayName: "OpenCode Go",
      allowedRuntimeIds: ["opencode"],
    });
    expect(e2bSandboxRuntimeDefinition).toMatchObject({
      familyId: "e2b",
      variantId: "e2b-default",
      kind: "sandbox",
      displayName: "E2B",
      sandboxRuntime: {
        providerId: "e2b",
        displayName: "E2B",
        resourceCapabilities: {
          vcpuCount: {
            min: 1,
            max: 8,
            step: 1,
            default: 2,
          },
          memoryMb: {
            min: 1024,
            max: 16_384,
            step: 1024,
            default: 4096,
          },
        },
      },
      connectionMethods: [
        {
          id: "api-key",
          label: "API key",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
              slotKey: "e2b.e2b-default.api-key.api-key",
            },
          ],
        },
      ],
    });
    expect(modalSandboxRuntimeDefinition).toMatchObject({
      familyId: "modal",
      variantId: "modal-default",
      kind: "sandbox",
      displayName: "Modal",
      sandboxRuntime: {
        providerId: "modal",
        displayName: "Modal",
      },
      connectionMethods: [
        {
          id: "api-key",
          label: "Token",
          kind: "form",
          secretFields: [
            {
              name: "tokenId",
              label: "Token ID",
              inputType: "password",
              slotKey: "modal.modal-default.api-key.token-id",
            },
            {
              name: "tokenSecret",
              label: "Token secret",
              inputType: "password",
              slotKey: "modal.modal-default.api-key.token-secret",
            },
          ],
        },
      ],
    });
    expect(tensorlakeSandboxRuntimeDefinition).toMatchObject({
      familyId: "tensorlake",
      variantId: "tensorlake-default",
      kind: "sandbox",
      displayName: "Tensorlake",
      sandboxRuntime: {
        providerId: "tensorlake",
        displayName: "Tensorlake",
        resourceCapabilities: {
          vcpuCount: {
            min: 1,
            max: 8,
            step: 1,
            default: 1,
          },
          memoryMb: {
            min: 1024,
            max: 65536,
            step: 1024,
            default: 1024,
            minPerVcpu: 1024,
            maxPerVcpu: 8192,
          },
        },
      },
      connectionMethods: [
        {
          id: "api-key",
          label: "API key",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
              slotKey: "tensorlake.tensorlake-default.api-key.api-key",
            },
          ],
        },
      ],
    });
    expect(openComputerSandboxRuntimeDefinition).toMatchObject({
      familyId: "opencomputer",
      variantId: "opencomputer-default",
      kind: "sandbox",
      displayName: "OpenComputer",
      sandboxRuntime: {
        providerId: "opencomputer",
        displayName: "OpenComputer",
        resourceCapabilities: {
          vcpuCount: {
            min: 1,
            max: 4,
            step: 1,
            default: 1,
          },
          memoryMb: {
            min: 1024,
            max: 16_384,
            step: 1024,
            default: 4096,
          },
          validResourcePairs: [
            { vcpuCount: 1, memoryMb: 1024 },
            { vcpuCount: 1, memoryMb: 4096 },
            { vcpuCount: 2, memoryMb: 8192 },
            { vcpuCount: 4, memoryMb: 16_384 },
          ],
        },
      },
      connectionMethods: [
        {
          id: "api-key",
          label: "API key",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
              slotKey: "opencomputer.opencomputer-default.api-key.api-key",
            },
          ],
        },
      ],
    });
    expect(planetscaleDefinition).toMatchObject({
      familyId: "planetscale",
      variantId: "planetscale-mcp",
      kind: "connector",
      displayName: "PlanetScale",
      connectionMethods: [
        {
          id: "oauth2-authorization-code",
          label: "PlanetScale OAuth",
          kind: "redirect",
          ui: {
            create: {
              submitLabel: "Connect PlanetScale",
              helperText: "Authorize PlanetScale hosted MCP access.",
            },
          },
        },
      ],
    });
    expect(planetscaleDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(postHogDefinition).toMatchObject({
      familyId: "posthog",
      variantId: "posthog-mcp",
      kind: "connector",
      displayName: "PostHog",
      connectionMethods: [
        {
          id: "oauth2-authorization-code",
          label: "PostHog OAuth",
          kind: "redirect",
          ui: {
            create: {
              submitLabel: "Connect PostHog",
              helperText: "Authorize PostHog hosted MCP access.",
            },
          },
        },
      ],
    });
    expect(postHogDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(railwayDefinition).toMatchObject({
      familyId: "railway",
      variantId: "railway-mcp",
      kind: "connector",
      displayName: "Railway",
      logoKey: "railway",
      connectionMethods: [
        {
          id: "oauth2-authorization-code",
          label: "Railway OAuth",
          kind: "redirect",
        },
      ],
    });
    expect(railwayDefinition?.mcp).toBeDefined();
    expect(railwayDefinition?.oauth2AuthorizationCode).toBeUndefined();
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
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
              slotKey: "render.render-mcp.api-key.api-key",
            },
          ],
        },
      ],
    });
    expect(renderDefinition?.mcp).toBeDefined();
    expect(notionDefinition).toMatchObject({
      familyId: "notion",
      variantId: "notion-mcp",
      kind: "connector",
      displayName: "Notion",
      connectionMethods: [
        {
          id: "oauth2-authorization-code",
          label: "Notion MCP OAuth",
          kind: "redirect",
          ui: {
            create: {
              submitLabel: "Connect Notion",
              helperText: "Authorize Notion hosted MCP access.",
            },
          },
        },
      ],
    });
    expect(notionDefinition?.oauth2AuthorizationCode).toBeUndefined();
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
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
              slotKey: "resend.resend-mcp.api-key.api-key",
            },
          ],
        },
      ],
    });
    expect(resendDefinition?.mcp).toBeDefined();
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
          setupFlow: {
            completionRequirements: {
              kind: "all-of",
              allOf: [
                {
                  kind: "secret-field",
                  field: "personalAccessToken",
                },
                {
                  kind: "secret-field",
                  field: "webhookSecret",
                },
                {
                  kind: "config-field",
                  field: "provider_configuration_setup_completed",
                },
              ],
            },
            routeSegment: "provider-configuration",
            setupPane: {
              kind: "provider-configuration",
            },
          },
          secretFields: [
            {
              name: "personalAccessToken",
              label: "Personal access token",
              inputType: "password",
              slotKey: "wasenderapi.wasenderapi-mcp.api-key.personal-access-token",
            },
            {
              name: "webhookSecret",
              label: "Webhook secret",
              inputType: "password",
              slotKey: "wasenderapi.wasenderapi-mcp.api-key.webhook-secret",
            },
          ],
        },
      ],
    });
    expect(wasenderApiDefinition?.mcp).toBeDefined();
    expect(wasenderApiDefinition?.webhookHandler).toBeUndefined();
    expect(wasenderApiDefinition?.webhookSource).toBeUndefined();
    const wasenderApiConnectionMethod = wasenderApiDefinition?.connectionMethods.find(
      (method) => method.id === "api-key",
    );
    expect(
      wasenderApiConnectionMethod?.kind === "form"
        ? wasenderApiConnectionMethod.setupFlow?.providerConfigurationSetup
        : undefined,
    ).toMatchObject({
      fields: {
        secretFields: [
          {
            name: "personalAccessToken",
            required: true,
          },
          {
            name: "webhookSecret",
            required: true,
          },
        ],
      },
      webhookCallback: {
        label: "Webhook URL",
      },
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
          setupFlow: {
            completionRequirements: {
              kind: "all-of",
              allOf: [
                {
                  kind: "secret-field",
                  field: "apiToken",
                },
                {
                  kind: "config-field",
                  field: "provider_configuration_setup_completed",
                },
              ],
            },
          },
          secretFields: [
            {
              name: "apiToken",
              label: "API token",
              inputType: "password",
              slotKey: "whapi.whapi-mcp.api-key.api-token",
            },
          ],
        },
      ],
    });
    expect(whapiDefinition?.mcp).toBeDefined();
    expect(whapiDefinition?.webhookHandler).toBeUndefined();
    expect(whapiDefinition?.webhookSource).toBeUndefined();
    expect(sentryDefinition).toMatchObject({
      familyId: "sentry",
      variantId: "sentry-mcp",
      kind: "connector",
      displayName: "Sentry",
      connectionMethods: [
        {
          id: "oauth2-authorization-code",
          label: "Sentry MCP OAuth",
          kind: "redirect",
          ui: {
            create: {
              submitLabel: "Connect Sentry",
              helperText: "Authorize Sentry hosted MCP access.",
            },
          },
        },
      ],
    });
    expect(sentryDefinition?.oauth2AuthorizationCode).toBeUndefined();
    expect(signozDefinition).toMatchObject({
      familyId: "signoz",
      variantId: "signoz-mcp",
      kind: "connector",
      displayName: "SigNoz",
      connectionMethods: [
        {
          id: "oauth2-authorization-code",
          label: "SigNoz OAuth",
          kind: "redirect",
          ui: {
            create: {
              submitLabel: "Connect SigNoz",
              helperText: "Authorize SigNoz hosted MCP access.",
            },
          },
        },
      ],
    });
    expect(signozDefinition?.oauth2AuthorizationCode).toBeUndefined();
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
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
              slotKey: "github.github-cloud.api-key.api-key",
            },
          ],
        },
        {
          id: "github-app-installation",
          label: "GitHub App installation",
          kind: "form",
          secretFields: [
            {
              name: "appPrivateKeyPem",
              label: "App private key PEM",
              inputType: "textarea",
              slotKey: "github.github-cloud.github-app-installation.app-private-key-pem",
            },
            {
              name: "clientSecret",
              label: "Client secret",
              inputType: "password",
              slotKey: "github.github-cloud.github-app-installation.client-secret",
            },
            {
              name: "webhookSecret",
              label: "Webhook secret",
              inputType: "password",
              slotKey: "github.github-cloud.github-app-installation.webhook-secret",
            },
          ],
        },
      ],
    });
    expect(githubCloudDefinition?.redirectHandler).toBeUndefined();
    expect(githubCloudDefinition?.webhookHandler).toBeUndefined();
    expect(githubCloudDefinition?.webhookSource).toBeUndefined();
    expect(githubCloudDefinition?.identityLinking).toEqual({
      eligibleConnectionMethodIds: ["github-app-installation"],
    });
    expect(githubCloudDefinition?.supportedWebhookEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "github.issue_comment.created",
          providerEventType: "issue_comment",
          displayName: "Issue comment created",
          category: "Issues",
          parameters: expect.arrayContaining([
            expect.objectContaining({
              id: "invocationToken",
              kind: "string",
              payloadPath: ["comment", "body"],
              matchMode: "contains_token",
              controlVariant: "invocation-token",
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
              id: "invocationToken",
              kind: "string",
              payloadPath: ["review", "body"],
              matchMode: "contains_token",
              controlVariant: "invocation-token",
            }),
          ]),
        }),
        expect.objectContaining({
          eventType: "github.pull_request.review_requested",
          providerEventType: "pull_request",
          displayName: "Pull request review requested",
          category: "Pull requests",
          parameters: expect.arrayContaining([
            expect.objectContaining({
              id: "botActor",
              kind: "resource-select",
              resourceKind: "bot",
              payloadPath: ["sender", "login"],
              multiValue: true,
            }),
            expect.objectContaining({
              id: "requestedReviewer",
              payloadPath: ["requested_reviewer", "login"],
              multiValue: true,
              negatedMatchRequiresExists: true,
            }),
            expect.objectContaining({
              id: "requestedTeam",
              kind: "resource-select",
              resourceKind: "team",
              payloadPath: ["requested_team", "slug"],
              multiValue: true,
              negatedMatchRequiresExists: true,
            }),
            expect.objectContaining({
              id: "requestedBot",
              kind: "resource-select",
              resourceKind: "bot",
              payloadPath: ["requested_reviewer", "login"],
              multiValue: true,
              negatedMatchRequiresExists: true,
            }),
          ]),
          parameterGroups: [
            {
              id: "actor",
              label: "actor",
              kind: "oneOf",
              options: [
                {
                  parameterId: "author",
                  label: "by user",
                },
                {
                  parameterId: "botActor",
                  label: "by bot",
                },
              ],
            },
            {
              id: "requestedReviewTarget",
              label: "requested review target",
              kind: "oneOf",
              options: [
                {
                  parameterId: "requestedReviewer",
                  label: "for reviewer",
                },
                {
                  parameterId: "requestedTeam",
                  label: "for team",
                },
                {
                  parameterId: "requestedBot",
                  label: "for bot",
                },
              ],
            },
          ],
        }),
        expect.objectContaining({
          eventType: "github.pull_request.review_request_removed",
          providerEventType: "pull_request",
          displayName: "Pull request review request removed",
          category: "Pull requests",
          parameters: expect.arrayContaining([
            expect.objectContaining({
              id: "botActor",
              kind: "resource-select",
              resourceKind: "bot",
              payloadPath: ["sender", "login"],
              multiValue: true,
            }),
            expect.objectContaining({
              id: "requestedReviewer",
              payloadPath: ["requested_reviewer", "login"],
              multiValue: true,
              negatedMatchRequiresExists: true,
            }),
            expect.objectContaining({
              id: "requestedTeam",
              kind: "resource-select",
              resourceKind: "team",
              payloadPath: ["requested_team", "slug"],
              multiValue: true,
              negatedMatchRequiresExists: true,
            }),
            expect.objectContaining({
              id: "requestedBot",
              kind: "resource-select",
              resourceKind: "bot",
              payloadPath: ["requested_reviewer", "login"],
              multiValue: true,
              negatedMatchRequiresExists: true,
            }),
          ]),
          parameterGroups: [
            {
              id: "actor",
              label: "actor",
              kind: "oneOf",
              options: [
                {
                  parameterId: "author",
                  label: "by user",
                },
                {
                  parameterId: "botActor",
                  label: "by bot",
                },
              ],
            },
            {
              id: "requestedReviewTarget",
              label: "requested review target",
              kind: "oneOf",
              options: [
                {
                  parameterId: "requestedReviewer",
                  label: "for reviewer",
                },
                {
                  parameterId: "requestedTeam",
                  label: "for team",
                },
                {
                  parameterId: "requestedBot",
                  label: "for bot",
                },
              ],
            },
          ],
        }),
        expect.objectContaining({
          eventType: "github.pull_request.ready_for_review",
          providerEventType: "pull_request",
          displayName: "Pull request ready for review",
          category: "Pull requests",
        }),
      ]),
    );
    let githubCloudResourceSelectParameterCount = 0;
    const githubCloudResourceSelectParameterMultiValueFlags: boolean[] = [];
    for (const eventDefinition of githubCloudDefinition?.supportedWebhookEvents ?? []) {
      for (const parameter of eventDefinition.parameters ?? []) {
        if (parameter.kind === "resource-select") {
          githubCloudResourceSelectParameterCount += 1;
          githubCloudResourceSelectParameterMultiValueFlags.push(parameter.multiValue === true);
        }
      }
    }
    expect(githubCloudResourceSelectParameterCount).toBeGreaterThan(0);
    expect(githubCloudResourceSelectParameterMultiValueFlags.every(Boolean)).toBe(true);
    expect(githubCloudDefinition?.credentialResolvers).toBeUndefined();
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
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
              slotKey: "github.github-enterprise-server.api-key.api-key",
            },
          ],
        },
        {
          id: "github-app-installation",
          label: "GitHub App installation",
          kind: "form",
          secretFields: [
            {
              name: "appPrivateKeyPem",
              label: "App private key PEM",
              inputType: "textarea",
              slotKey:
                "github.github-enterprise-server.github-app-installation.app-private-key-pem",
            },
            {
              name: "webhookSecret",
              label: "Webhook secret",
              inputType: "password",
              slotKey: "github.github-enterprise-server.github-app-installation.webhook-secret",
            },
          ],
        },
      ],
    });
    expect(githubEnterpriseServerDefinition?.redirectHandler).toBeUndefined();
    expect(githubEnterpriseServerDefinition?.webhookHandler).toBeUndefined();
    expect(githubEnterpriseServerDefinition?.webhookSource).toBeUndefined();
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
    expect(githubEnterpriseServerDefinition?.credentialResolvers).toBeUndefined();
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
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
              slotKey: "linear.linear-default.api-key.api-key",
            },
          ],
        },
      ],
    });
    expect(linearDefinition?.mcp).toBeDefined();
    expect(linearDefinition?.webhookSource).toBeUndefined();
    expect(linearDefinition?.webhookHandler).toBeUndefined();
    expect(linearDefinition?.supportedWebhookEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "linear.issue.created",
          providerEventType: "Issue",
          displayName: "Issue created",
          category: "Issues",
        }),
        expect.objectContaining({
          eventType: "linear.comment.created",
          providerEventType: "Comment",
          displayName: "Comment created",
          category: "Comments",
        }),
      ]),
    );
    expect(slackDefinition).toMatchObject({
      familyId: "slack",
      variantId: "slack-default",
      kind: "connector",
      displayName: "Slack",
      connectionMethods: [
        {
          id: "slack-bot-token",
          label: "Slack app",
          kind: "form",
          secretFields: [
            {
              name: "botToken",
              label: "Bot token",
              inputType: "password",
              slotKey: "slack.slack-default.slack-bot-token.bot-token",
            },
            {
              name: "signingSecret",
              label: "Signing secret",
              inputType: "password",
              slotKey: "slack.slack-default.slack-bot-token.signing-secret",
            },
            {
              name: "clientSecret",
              label: "Client secret (Linked User Auth)",
              description:
                "Required only for Identity Linking / linked user authorization. Not required for standard Slack app bot-token usage.",
              inputType: "password",
              optional: true,
              slotKey: "slack.slack-default.slack-bot-token.client-secret",
            },
          ],
        },
      ],
    });
    expect(slackDefinition?.webhookSource).toBeUndefined();
    expect(slackDefinition?.webhookHandler).toBeUndefined();
    expect(slackDefinition?.identityLinking).toEqual({
      eligibleConnectionMethodIds: ["slack-bot-token"],
    });
    expect(slackDefinition?.supportedWebhookEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "slack:message",
          providerEventType: "message",
          displayName: "Message",
          category: "Messages",
        }),
        expect.objectContaining({
          eventType: "slack:reaction_added",
          providerEventType: "reaction_added",
          displayName: "Reaction added",
          category: "Reactions",
        }),
      ]),
    );
  });

  it("lists registered definitions", () => {
    const definitions = listIntegrationDefinitions();

    expect(definitions).toHaveLength(42);
    expect(
      definitions.map((definition) => `${definition.familyId}::${definition.variantId}`),
    ).toEqual([
      "agentmail::agentmail-mcp",
      "anthropic::anthropic-default",
      "aws::aws-cli-default",
      "bugsnag::bugsnag-mcp",
      "cloudflare::cloudflare-mcp",
      "datadog::datadog-default",
      "deepseek::deepseek-default",
      "expo::expo-mcp",
      "fireworks::fireworks-default",
      "gcp::gcp-mcp",
      "google-analytics::google-analytics-mcp",
      "google-workspace::google-workspace-mcp",
      "inception::inception-default",
      "jira::jira-default",
      "kimi::kimi-default",
      "github::github-cloud",
      "github::github-enterprise-server",
      "linear::linear-default",
      "metaads::metaads-default",
      "minimax::minimax-default",
      "notion::notion-mcp",
      "openai::openai-default",
      "opencode::opencode-go",
      "openrouter::openrouter-default",
      "planetscale::planetscale-mcp",
      "posthog::posthog-mcp",
      "railway::railway-mcp",
      "render::render-mcp",
      "resend::resend-mcp",
      "e2b::e2b-default",
      "modal::modal-default",
      "opencomputer::opencomputer-default",
      "tensorlake::tensorlake-default",
      "sentry::sentry-mcp",
      "signoz::signoz-mcp",
      "slack::slack-default",
      "shopify::shopify-default",
      "stripe::stripe-mcp",
      "supabase::supabase-mcp",
      "wasenderapi::wasenderapi-mcp",
      "whapi::whapi-mcp",
      "zai::zai-coding-plan",
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
    for (const runtime of definitions.agentRuntimeRegistry.listRuntimes()) {
      expect(Object.hasOwn(runtime, "compileRuntime")).toBe(false);
    }
  });
});
