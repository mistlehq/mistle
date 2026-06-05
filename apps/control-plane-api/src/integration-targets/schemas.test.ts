import { describe, expect, it } from "vitest";

import { IntegrationTargetSchema } from "./schemas.js";

describe("IntegrationTargetSchema", () => {
  it("parses webhook event parameter group metadata", () => {
    const parsed = IntegrationTargetSchema.parse({
      targetKey: "github-cloud",
      familyId: "github",
      variantId: "github-cloud",
      kind: "git",
      enabled: true,
      config: {},
      displayName: "GitHub",
      description: "GitHub integration",
      connectionMethods: [
        {
          id: "github-app-installation",
          label: "GitHub App installation",
          kind: "redirect",
          ui: {
            create: {
              submitLabel: "Install GitHub App",
              helperText: "Connect GitHub.",
            },
          },
        },
      ],
      supportedWebhookEvents: [
        {
          eventType: "github.pull_request.review_requested",
          providerEventType: "pull_request",
          displayName: "Pull request review requested",
          parameters: [
            {
              id: "requestedReviewer",
              label: "Reviewer",
              kind: "resource-select",
              resourceKind: "user",
              payloadPath: ["requested_reviewer", "login"],
              negatedMatchRequiresExists: true,
            },
            {
              id: "requestedTeam",
              label: "Team",
              kind: "resource-select",
              resourceKind: "team",
              payloadPath: ["requested_team", "slug"],
              negatedMatchRequiresExists: true,
            },
          ],
          parameterGroups: [
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
              ],
            },
          ],
        },
      ],
      targetHealth: {
        configStatus: "valid",
      },
    });

    expect(parsed.supportedWebhookEvents?.[0]?.parameterGroups).toEqual([
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
        ],
      },
    ]);
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
      kind: "connector",
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
            providerAppSetup: {
              title: "Choose a setup method",
              description: "Create or connect a Slack app.",
              installedNoticeTitle: "Slack app connected successfully",
              manifest: {
                title: "Slack app manifest",
                description: "Create a Slack app from a manifest.",
                createErrorMessage: "Could not create Slack app manifest.",
                startAction: {
                  expectedResultKind: "redirect",
                  manifestBodyField: "manifest",
                  unexpectedResultMessage:
                    "Slack app manifest setup did not return a redirect URL.",
                },
              },
              existingApp: {
                title: "Existing Slack App",
                description: "Paste values from an existing Slack app.",
                connectLabel: "Connect Slack to Mistle",
                installedDetection: {
                  configFields: ["appId"],
                  secretFields: ["botToken", "signingSecret"],
                },
                saveErrorMessage: "Could not save Slack app setup.",
                configFields: [
                  {
                    configKey: "app_id",
                    name: "appId",
                    label: "App ID",
                    required: true,
                  },
                ],
                secretFields: [
                  {
                    inputType: "password",
                    name: "botToken",
                    label: "Bot token",
                    required: true,
                    secretLabel: "bot token",
                  },
                  {
                    inputType: "password",
                    name: "signingSecret",
                    label: "Signing secret",
                    required: true,
                    secretLabel: "signing secret",
                  },
                ],
              },
              urls: {
                title: "Slack app URLs",
                description: "Copy this URL into Slack Event Subscriptions.",
                webhookCallback: {
                  label: "Events API Request URL",
                  errorTitle: "Could not load Events API Request URL",
                  missingTitle: "Events API Request URL is not available yet",
                  missingMessage: "Setup requires an Events API Request URL.",
                },
              },
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
        providerAppSetup: {
          installedNoticeTitle: "Slack app connected successfully",
        },
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

  it("parses form post-create managed webhook metadata", () => {
    const parsed = IntegrationTargetSchema.parse({
      targetKey: "jira-default",
      familyId: "jira",
      variantId: "jira-default",
      kind: "connector",
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
