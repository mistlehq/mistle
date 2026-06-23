import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { GoogleAnalyticsToolIds } from "./tool-ids.js";

type GoogleAnalyticsBindingFormContext = IntegrationFormContext;

export function resolveGoogleAnalyticsBindingConfigForm(
  _input: GoogleAnalyticsBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_MCP],
          items: {
            type: "string",
            enum: [
              GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_CLI,
              GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_MCP,
            ],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Google Analytics CLI", "Google Analytics MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
