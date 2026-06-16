import {
  IntegrationConnectionMethodIds,
  type ResolvedIntegrationForm,
} from "@mistle/integrations-core";

import { ResendToolIds } from "./tool-ids.js";

export function resolveResendBindingConfigForm(): ResolvedIntegrationForm {
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
        "ui:placeholder": "support@example.com, sales@example.com",
        "ui:widget": "comma-separated-string-array",
      },
    },
  };
}

export const ResendConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: IntegrationConnectionMethodIds.API_KEY,
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
  },
};
