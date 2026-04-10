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
              helperText: "Continue to device authorization.",
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
            helperText: "Continue to device authorization.",
          },
          pending: {
            title: "Waiting for approval",
            description: "Finish approval in your browser.",
          },
        },
      },
    ]);
  });
});
