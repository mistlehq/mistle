import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { LinearToolIds } from "./tool-ids.js";

type LinearBindingFormContext = IntegrationFormContext;

export function resolveLinearBindingConfigForm(
  _input: LinearBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [],
          items: {
            type: "string",
            enum: [LinearToolIds.LINEAR_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Linear MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
