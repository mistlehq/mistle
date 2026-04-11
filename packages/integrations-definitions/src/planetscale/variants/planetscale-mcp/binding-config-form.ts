import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { PlanetScaleToolIds } from "./tool-ids.js";

type PlanetScaleBindingFormContext = IntegrationFormContext;

export function resolvePlanetScaleBindingConfigForm(
  _input: PlanetScaleBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [],
          items: {
            type: "string",
            enum: [PlanetScaleToolIds.PLANETSCALE_MCP, PlanetScaleToolIds.PLANETSCALE_INSIGHTS_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["PlanetScale MCP", "PlanetScale Insights MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
