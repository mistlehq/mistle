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
      },
    });
  });
});
