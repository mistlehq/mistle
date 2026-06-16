import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { RenderToolIds } from "./tool-ids.js";

type RenderBindingFormContext = IntegrationFormContext;

export function resolveRenderBindingConfigForm(
  _input: RenderBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [RenderToolIds.RENDER_MCP],
          items: {
            type: "string",
            enum: [RenderToolIds.RENDER_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Render MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
