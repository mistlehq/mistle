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
});
