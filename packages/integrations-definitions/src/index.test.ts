import { describe, expect, it } from "vitest";

import {
  createDefinitionsBundle,
  createIntegrationRegistry,
  listIntegrationDefinitions,
} from "./index.js";

describe("integrations-definitions index", () => {
  it("registers built-in browser-safe integration definitions in a registry", () => {
    const registry = createIntegrationRegistry();
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
    const githubEnterpriseServerDefinition = registry.getDefinition({
      familyId: "github",
      variantId: "github-enterprise-server",
    });
    const linearDefinition = registry.getDefinition({
      familyId: "linear",
      variantId: "linear-default",
    });
    const slackDefinition = registry.getDefinition({
      familyId: "slack",
      variantId: "slack-default",
    });

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
          label: "Bot token",
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
          ],
        },
      ],
    });
    expect(slackDefinition?.webhookSource).toBeUndefined();
    expect(slackDefinition?.webhookHandler).toBeUndefined();
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

    expect(definitions).toHaveLength(6);
    expect(
      definitions.map((definition) => `${definition.familyId}::${definition.variantId}`),
    ).toEqual([
      "jira::jira-default",
      "github::github-cloud",
      "github::github-enterprise-server",
      "linear::linear-default",
      "openai::openai-default",
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
    expect(definitions.agentRuntimeRegistry.listRuntimes()).toHaveLength(1);
    expect(definitions.agentRuntimeRegistry.listRuntimes()[0]).toMatchObject({
      runtimeId: "codex",
      displayName: "Codex",
    });
  });
});
