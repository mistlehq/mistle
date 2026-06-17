import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { TensorlakeToolIds } from "./constants.js";

type TensorlakeBindingFormContext = IntegrationFormContext;

export function resolveTensorlakeBindingConfigForm(
  _input: TensorlakeBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [],
          items: {
            type: "string",
            enum: [TensorlakeToolIds.TENSORLAKE_CLI],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Tensorlake CLI"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
