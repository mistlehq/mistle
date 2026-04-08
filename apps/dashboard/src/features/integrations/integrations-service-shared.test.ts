import { describe, expect, it } from "vitest";

import { IntegrationTargetsPageSchema } from "./integrations-service-shared.js";

describe("IntegrationTargetsPageSchema", () => {
  it("accepts form connection methods with slot-keyed secret fields", () => {
    const result = IntegrationTargetsPageSchema.parse({
      items: [
        {
          targetKey: "openai",
          familyId: "openai",
          variantId: "openai-default",
          enabled: true,
          config: {},
          displayName: "OpenAI",
          description: "Connect OpenAI to Mistle.",
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
                  slotKey: "openai.openai-default.api-key.api-key",
                },
              ],
            },
          ],
          targetHealth: {
            configStatus: "valid",
          },
        },
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 1,
    });

    expect(result.items[0]?.connectionMethods?.[0]).toEqual({
      id: "api-key",
      label: "API key",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          inputType: "password",
          slotKey: "openai.openai-default.api-key.api-key",
        },
      ],
    });
  });
});
