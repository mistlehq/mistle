import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { ResendToolIds } from "./tool-ids.js";

type ResendBindingFormContext = IntegrationFormContext;

export function resolveResendBindingConfigForm(
  _input: ResendBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
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
          description:
            "Optional verified sender email address injected into Resend MCP. If omitted, the MCP tool asks for a sender when needed.",
          type: "string",
          format: "email",
        },
        replyToEmailAddresses: {
          title: "Default reply-to emails",
          description: "Optional reply-to email addresses injected into Resend MCP.",
          type: "array",
          items: {
            type: "string",
            format: "email",
          },
          default: [],
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Resend MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
      senderEmailAddress: {
        "ui:placeholder": "onboarding@example.com",
      },
      replyToEmailAddresses: {
        "ui:placeholder": "support@example.com",
      },
    },
  };
}
