import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { OpenComputerToolIds } from "./constants.js";

type OpenComputerBindingFormContext = IntegrationFormContext;

export function resolveOpenComputerBindingConfigForm(
  _input: OpenComputerBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [],
          items: {
            type: "string",
            enum: [OpenComputerToolIds.OPENCOMPUTER_CLI],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["OpenComputer CLI"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
