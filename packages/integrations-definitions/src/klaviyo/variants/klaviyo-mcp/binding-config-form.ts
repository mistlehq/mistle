import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { KlaviyoToolIds } from "./tool-ids.js";

type KlaviyoBindingFormContext = IntegrationFormContext;

export function resolveKlaviyoBindingConfigForm(
  _input: KlaviyoBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [KlaviyoToolIds.KLAVIYO_MCP],
          items: {
            type: "string",
            enum: [KlaviyoToolIds.KLAVIYO_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Klaviyo MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
