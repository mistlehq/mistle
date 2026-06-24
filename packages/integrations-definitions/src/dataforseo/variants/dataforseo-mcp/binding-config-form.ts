import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { DataForSeoToolIds } from "./tool-ids.js";

type DataForSeoBindingFormContext = IntegrationFormContext;

export function resolveDataForSeoBindingConfigForm(
  _input: DataForSeoBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [DataForSeoToolIds.DATAFORSEO_MCP],
          items: {
            type: "string",
            enum: [DataForSeoToolIds.DATAFORSEO_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["DataForSEO MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
