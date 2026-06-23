import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { GoogleAdsToolIds } from "./tool-ids.js";

type GoogleAdsBindingFormContext = IntegrationFormContext;

export function resolveGoogleAdsBindingConfigForm(
  _input: GoogleAdsBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [GoogleAdsToolIds.GOOGLEADS_MCP],
          items: {
            type: "string",
            enum: [GoogleAdsToolIds.GOOGLEADS_CLI, GoogleAdsToolIds.GOOGLEADS_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Google Ads CLI", "Google Ads MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
