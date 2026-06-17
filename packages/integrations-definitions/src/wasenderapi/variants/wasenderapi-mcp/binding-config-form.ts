import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { WasenderApiToolIds } from "./tool-ids.js";

type WasenderApiBindingFormContext = IntegrationFormContext;

export function resolveWasenderApiBindingConfigForm(
  _input: WasenderApiBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [WasenderApiToolIds.WASENDERAPI_MCP],
          items: {
            type: "string",
            enum: [WasenderApiToolIds.WASENDERAPI_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["WasenderAPI MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
