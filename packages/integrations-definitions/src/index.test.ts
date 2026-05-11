import { describe, expect, it } from "vitest";

import {
  createDefinitionsBundle,
  createIntegrationRegistry,
  listIntegrationDefinitions,
} from "./index.js";

describe("integrations-definitions index", () => {
  it("registers built-in browser-safe integration definitions in a registry", () => {
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
    const openAiDefinition = registry.getDefinition({
      familyId: "openai",
      variantId: "openai-default",
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
    const linearDefinition = registry.getDefinition({
      familyId: "linear",
      variantId: "linear-default",
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
    expect(openAiDefinition?.displayName).toBe("OpenAI");
    expect(openAiDefinition?.kind).toBe("agent");
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
            max: 8192,
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
      ]),
    );
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

    expect(definitions).toHaveLength(11);
    expect(
      definitions.map((definition) => `${definition.familyId}::${definition.variantId}`),
    ).toEqual([
      "aws::aws-cli-default",
      "datadog::datadog-default",
      "jira::jira-default",
      "github::github-cloud",
      "github::github-enterprise-server",
      "linear::linear-default",
      "openai::openai-default",
      "planetscale::planetscale-mcp",
      "e2b::e2b-default",
      "signoz::signoz-mcp",
      "slack::slack-default",
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
        runtimeId: "codex",
        displayName: "Codex",
      },
      {
        runtimeId: "opencode",
        displayName: "OpenCode",
      },
    ]);
  });
});
