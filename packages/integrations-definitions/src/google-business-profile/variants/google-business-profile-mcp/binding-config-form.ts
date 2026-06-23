import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { GoogleBusinessProfileToolIds } from "./tool-ids.js";

type GoogleBusinessProfileBindingFormContext = IntegrationFormContext;

export function resolveGoogleBusinessProfileBindingConfigForm(
  _input: GoogleBusinessProfileBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_MCP],
          items: {
            type: "string",
            enum: [
              GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_CLI,
              GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_MCP,
            ],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Google Business Profile CLI", "Google Business Profile MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
