import { describe, expect, it } from "vitest";

import { IntegrationTargetSchema } from "./schemas.js";

describe("IntegrationTargetSchema", () => {
  it("parses device-authorization connection methods", () => {
    const parsed = IntegrationTargetSchema.parse({
      targetKey: "openai-default",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {},
      displayName: "OpenAI",
      description: "OpenAI integration",
      connectionMethods: [
        {
          id: "chatgpt-device-code",
          label: "ChatGPT subscription",
          kind: "device-authorization",
          ui: {
            create: {
              submitLabel: "Start device authorization",
            },
            pending: {
              title: "Finish sign-in",
              description: "Complete the device authorization in your browser.",
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
            submitLabel: "Start device authorization",
          },
          pending: {
            title: "Finish sign-in",
            description: "Complete the device authorization in your browser.",
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
      enabled: true,
      config: {},
      displayName: "Slack",
      description: "Slack integration",
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
                    "Generate a Slack app configuration token, then paste it here. Slack configuration tokens expire after 12 hours.",
                  actions: [
                    {
                      label: "Generate token in Slack",
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
              slotKey: "slack.slack-default.slack-bot-token.bot-token",
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
          slotKey: "slack.slack-default.slack-bot-token.bot-token",
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
                "Generate a Slack app configuration token, then paste it here. Slack configuration tokens expire after 12 hours.",
              actions: [
                {
                  label: "Generate token in Slack",
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

  it("parses form post-create managed webhook metadata", () => {
    const parsed = IntegrationTargetSchema.parse({
      targetKey: "jira-default",
      familyId: "jira",
      variantId: "jira-default",
      enabled: true,
      config: {},
      displayName: "Jira",
      description: "Jira integration",
      connectionMethods: [
        {
          id: "jira-personal-api-token",
          label: "Personal API token",
          kind: "form",
          postCreate: {
            managedWebhookSource: {
              autoCreate: true,
              failureNoticeTitle: "Connection created, webhook setup failed",
              successNoticeTitle: "Jira connection and webhook created successfully",
            },
          },
          secretFields: [
            {
              name: "apiKey",
              label: "Personal API token",
              inputType: "password",
              slotKey: "jira.jira-default.jira-personal-api-token.api-key",
            },
          ],
        },
      ],
      targetHealth: {
        configStatus: "valid",
      },
    });

    expect(parsed.connectionMethods?.[0]).toMatchObject({
      id: "jira-personal-api-token",
      kind: "form",
      postCreate: {
        managedWebhookSource: {
          autoCreate: true,
          failureNoticeTitle: "Connection created, webhook setup failed",
          successNoticeTitle: "Jira connection and webhook created successfully",
        },
      },
    });
  });
});
