import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { RailwayToolIds } from "./tool-ids.js";

type RailwayBindingFormContext = IntegrationFormContext;

export function resolveRailwayBindingConfigForm(
  _input: RailwayBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [RailwayToolIds.RAILWAY_MCP],
          items: {
            type: "string",
            enum: [RailwayToolIds.RAILWAY_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Railway MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
