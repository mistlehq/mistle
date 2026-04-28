import { describe, expect, it } from "vitest";

import { IntegrationTargetSchema } from "./integrations-service-shared.js";

describe("IntegrationTargetSchema", () => {
  it("parses device-authorization connection methods", () => {
    const parsed = IntegrationTargetSchema.parse({
      targetKey: "openai-default",
      familyId: "openai",
      variantId: "openai-default",
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
      },
    });
  });
});
