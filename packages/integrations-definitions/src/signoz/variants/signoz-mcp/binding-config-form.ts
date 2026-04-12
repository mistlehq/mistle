import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { SignozToolIds } from "./tool-ids.js";

type SignozBindingFormContext = IntegrationFormContext;

export function resolveSignozBindingConfigForm(
  _input: SignozBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [],
          items: {
            type: "string",
            enum: [SignozToolIds.SIGNOZ_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["SigNoz MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
