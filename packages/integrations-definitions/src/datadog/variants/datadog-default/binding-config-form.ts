import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { DatadogToolIds } from "./tool-ids.js";

type DatadogBindingFormContext = IntegrationFormContext;

export function resolveDatadogBindingConfigForm(
  _input: DatadogBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [DatadogToolIds.DATADOG_MCP],
          items: {
            type: "string",
            enum: [DatadogToolIds.DATADOG_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Datadog MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
