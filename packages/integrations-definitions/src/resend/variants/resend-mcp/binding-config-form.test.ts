import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveResendBindingConfigForm } from "./binding-config-form.js";
import { ResendBindingConfigSchema } from "./binding-config-schema.js";
import { ResendToolIds } from "./tool-ids.js";

describe("resend binding config forms", () => {
  it("defaults Resend MCP to selected and exposes optional sender fields", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: ResendBindingConfigSchema,
      form: resolveResendBindingConfigForm,
      context: {
        familyId: "resend",
        variantId: "resend-mcp",
        kind: "connector",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        tools: {
          title: "Tools",
          default: [ResendToolIds.RESEND_MCP],
          items: {
            type: "string",
            enum: [ResendToolIds.RESEND_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
        senderEmailAddress: {
          title: "Default sender email",
          type: "string",
          format: "email",
        },
        replyToEmailAddresses: {
          title: "Default reply-to emails",
          type: "array",
        },
      },
    });
    expect(resolvedForm.uiSchema).toMatchObject({
      tools: {
        "ui:enumNames": ["Resend MCP"],
        "ui:widget": "checkboxes",
      },
      senderEmailAddress: {
        "ui:placeholder": "onboarding@example.com",
      },
      replyToEmailAddresses: {
        "ui:placeholder": "support@example.com",
      },
    });
  });
});
