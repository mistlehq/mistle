import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { E2BToolIds } from "./constants.js";

type E2BBindingFormContext = IntegrationFormContext;

export function resolveE2BBindingConfigForm(
  _input: E2BBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [],
          items: {
            type: "string",
            enum: [E2BToolIds.E2B_CLI],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["E2B CLI"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
