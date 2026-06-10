import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  IntegrationTargetSchema,
  IntegrationsApiError,
  readJsonWithSchema,
} from "./integrations-service-shared.js";

describe("IntegrationTargetSchema", () => {
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

describe("readJsonWithSchema", () => {
  it("reports the operation and schema path when an integration response payload is invalid", async () => {
    const response = new Response(
      JSON.stringify({
        items: [
          {
            targetKey: "",
          },
        ],
      }),
    );

    const error = await readJsonWithSchema({
      response,
      operation: "listIntegrationTargets",
      schema: z
        .object({
          items: z.array(
            z
              .object({
                targetKey: z.string().min(1),
              })
              .strict(),
          ),
        })
        .strict(),
    }).catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(IntegrationsApiError);
    if (!(error instanceof IntegrationsApiError)) {
      throw error;
    }

    expect(error.message).toContain(
      "Integration API response payload is invalid for listIntegrationTargets",
    );
    expect(error.message).toContain("items.0.targetKey");
  });
});
