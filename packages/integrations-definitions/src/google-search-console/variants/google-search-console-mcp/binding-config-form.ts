import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { GoogleSearchConsoleToolIds } from "./tool-ids.js";

type GoogleSearchConsoleBindingFormContext = IntegrationFormContext;

export function resolveGoogleSearchConsoleBindingConfigForm(
  _input: GoogleSearchConsoleBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_MCP],
          items: {
            type: "string",
            enum: [
              GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_CLI,
              GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_MCP,
            ],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Google Search Console CLI", "Google Search Console MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
