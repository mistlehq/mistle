import { describe, expect, it } from "vitest";

import { IntegrationTargetSchema } from "./integrations-service-shared.js";

describe("IntegrationTargetSchema", () => {
  it("parses actor policy target metadata used by webhook trigger controls", () => {
    const parsed = IntegrationTargetSchema.parse({
      targetKey: "slack-default",
      familyId: "slack",
      variantId: "slack-default",
      kind: "connector",
      enabled: true,
      config: {},
      displayName: "Slack",
      description: "Slack",
      resourceDefinitions: [
        {
          kind: "user",
          selectionMode: "multi",
          bindingField: "users",
          displayNameSingular: "user",
          displayNamePlural: "users",
          attributeDefinitions: [
            {
              key: "is_bot",
              valueType: "boolean",
              displayName: "Bot user",
              actorPolicyEligible: true,
            },
          ],
        },
      ],
      resourceRelationshipDefinitions: [
        {
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          objectResourceKind: "workspace",
          displayName: "Workspace members",
          scopeDefinitions: [
            {
              scopeKind: "workspace",
              displayName: "Workspace",
            },
          ],
        },
      ],
      supportedWebhookEvents: [
        {
          eventType: "slack.app_mention",
          providerEventType: "app_mention",
          displayName: "App mention",
          payloadReferences: [
            {
              path: ["event"],
              description: "Raw Slack event payload",
              allowsDescendants: true,
            },
          ],
          actor: {
            resourceReferences: [
              {
                resourceKind: "user",
                externalIdPayloadPath: ["event", "user"],
                when: {
                  payloadPath: ["event", "type"],
                  equals: "app_mention",
                },
              },
            ],
          },
        },
      ],
      targetHealth: {
        configStatus: "valid",
      },
    });

    expect(parsed.supportedWebhookEvents?.[0]?.payloadReferences?.[0]).toEqual({
      path: ["event"],
      description: "Raw Slack event payload",
      allowsDescendants: true,
    });
    expect(parsed.supportedWebhookEvents?.[0]?.actor?.resourceReferences[0]).toEqual({
      resourceKind: "user",
      externalIdPayloadPath: ["event", "user"],
      when: {
        payloadPath: ["event", "type"],
        equals: "app_mention",
      },
    });
    expect(parsed.resourceDefinitions?.[0]?.attributeDefinitions?.[0]).toMatchObject({
      key: "is_bot",
      actorPolicyEligible: true,
    });
    expect(parsed.resourceRelationshipDefinitions?.[0]).toMatchObject({
      relationshipKind: "belongs_to",
      subjectResourceKind: "user",
      objectResourceKind: "workspace",
    });
  });

  it("parses device-authorization connection methods", () => {
    const parsed = IntegrationTargetSchema.parse({
      targetKey: "openai-default",
      familyId: "openai",
      variantId: "openai-default",
      kind: "agent",
      enabled: true,
      config: {},
      displayName: "OpenAI",
      description: "OpenAI",
      connectionMethods: [
        {
          id: "chatgpt-device-code",
          label: "ChatGPT subscription",
          kind: "device-authorization",
          ui: {
            create: {
              submitLabel: "Continue",
            },
            pending: {
              title: "Waiting for approval",
              description: "Finish approval in your browser.",
            },
            reauthorize: {
              actionLabel: "Re-authorize",
              pendingLabel: "Starting...",
            },
          },
        },
      ],
      targetHealth: {
        configStatus: "valid",
      },
    });

    expect(parsed.connectionMethods).toEqual([
      {
        id: "chatgpt-device-code",
        label: "ChatGPT subscription",
        kind: "device-authorization",
        ui: {
          create: {
            submitLabel: "Continue",
          },
          pending: {
            title: "Waiting for approval",
            description: "Finish approval in your browser.",
          },
          reauthorize: {
            actionLabel: "Re-authorize",
            pendingLabel: "Starting...",
          },
        },
      },
    ]);
  });

  it("parses draft-then-setup form connection method metadata", () => {
    const parsed = IntegrationTargetSchema.parse({
      targetKey: "slack-default",
      familyId: "slack",
      variantId: "slack-default",
      kind: "connector",
      enabled: true,
      config: {},
      displayName: "Slack",
      description: "Slack",
      connectionMethods: [
        {
          id: "slack-bot-token",
          label: "Slack app",
          kind: "form",
          createBehavior: "draft-then-setup",
          setupFlow: {
            completionRequirements: {
              kind: "all-of",
              allOf: [
                {
                  kind: "secret-field",
                  field: "botToken",
                },
                {
                  kind: "secret-field",
                  field: "signingSecret",
                },
              ],
            },
            routeSegment: "slack-app",
            startForm: {
              submitLabel: "Create and connect Slack app",
              fields: [
                {
                  name: "appConfigToken",
                  label: "App configuration token",
                  inputType: "password",
                  required: true,
                  placeholder: "xoxe.xoxp-...",
                  description:
                    "Generate a temporary token from https://api.slack.com/apps and paste it below",
                  actions: [
                    {
                      label: "https://api.slack.com/apps",
                      href: "https://api.slack.com/apps",
                      opensInNewWindow: true,
                    },
                  ],
                },
              ],
            },
          },
          secretFields: [
            {
              name: "botToken",
              label: "Bot token",
              optional: true,
              inputType: "password",
            },
          ],
        },
      ],
      targetHealth: {
        configStatus: "valid",
      },
    });

    expect(parsed.connectionMethods?.[0]).toMatchObject({
      id: "slack-bot-token",
      kind: "form",
      createBehavior: "draft-then-setup",
      secretFields: [
        {
          name: "botToken",
          label: "Bot token",
          optional: true,
          inputType: "password",
        },
      ],
      setupFlow: {
        completionRequirements: {
          kind: "all-of",
          allOf: [
            {
              kind: "secret-field",
              field: "botToken",
            },
            {
              kind: "secret-field",
              field: "signingSecret",
            },
          ],
        },
        routeSegment: "slack-app",
        startForm: {
          submitLabel: "Create and connect Slack app",
          fields: [
            {
              name: "appConfigToken",
              label: "App configuration token",
              inputType: "password",
              required: true,
              placeholder: "xoxe.xoxp-...",
              description:
                "Generate a temporary token from https://api.slack.com/apps and paste it below",
              actions: [
                {
                  label: "https://api.slack.com/apps",
                  href: "https://api.slack.com/apps",
                  opensInNewWindow: true,
                },
              ],
            },
          ],
        },
      },
    });
  });
});
