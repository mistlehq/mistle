import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { StripeToolIds } from "./tool-ids.js";

type StripeBindingFormContext = IntegrationFormContext;

export function resolveStripeBindingConfigForm(
  _input: StripeBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [StripeToolIds.STRIPE_MCP],
          items: {
            type: "string",
            enum: [StripeToolIds.STRIPE_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Stripe MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
