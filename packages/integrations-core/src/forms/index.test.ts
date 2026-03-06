import { describe, expect, it } from "vitest";
import { z } from "zod";

import { applySchemaDefaultsToFormData, resolveIntegrationForm } from "./index.js";

describe("integration forms helpers", () => {
  it("merges form overrides onto base zod-derived json schema", () => {
    const resolved = resolveIntegrationForm({
      schema: z
        .object({
          runtime: z.literal("codex-cli"),
          model: z.enum(["gpt-5-mini", "gpt-5"]),
        })
        .strict(),
      form: {
        schema: {
          properties: {
            runtime: {
              default: "codex-cli",
            },
            model: {
              title: "Default model",
            },
          },
        },
        uiSchema: {
          runtime: {
            "ui:widget": "hidden",
          },
        },
      },
      context: {
        familyId: "openai",
        variantId: "openai-default",
        kind: "agent",
      },
    });

    expect(resolved.schema).toMatchObject({
      type: "object",
      properties: {
        runtime: {
          type: "string",
          const: "codex-cli",
          default: "codex-cli",
        },
        model: {
          type: "string",
          title: "Default model",
          enum: ["gpt-5-mini", "gpt-5"],
        },
      },
    });
    expect(resolved.uiSchema).toEqual({
      runtime: {
        "ui:widget": "hidden",
      },
    });
  });

  it("supports context-aware form resolution", () => {
    const resolved = resolveIntegrationForm({
      schema: z
        .object({
          model: z.string(),
        })
        .strict(),
      form: ({ connection }) => ({
        schema: {
          properties: {
            model: {
              default: connection?.config.auth_scheme === "oauth" ? "gpt-5" : "gpt-5-mini",
            },
          },
        },
      }),
      context: {
        familyId: "openai",
        variantId: "openai-default",
        kind: "agent",
        connection: {
          rawConfig: {
            auth_scheme: "oauth",
          },
          config: {
            auth_scheme: "oauth",
          },
        },
      },
    });

    expect(resolved.schema).toMatchObject({
      properties: {
        model: {
          default: "gpt-5",
        },
      },
    });
  });

  it("reapplies defaults when a oneOf-backed current value is no longer valid", () => {
    const nextFormData = applySchemaDefaultsToFormData({
      schema: {
        type: "object",
        properties: {
          reasoningEffort: {
            oneOf: [
              {
                const: "medium",
                title: "Medium",
              },
            ],
            default: "medium",
          },
        },
      },
      formData: {
        reasoningEffort: "high",
      },
    });

    expect(nextFormData).toEqual({
      reasoningEffort: "medium",
    });
  });
});
