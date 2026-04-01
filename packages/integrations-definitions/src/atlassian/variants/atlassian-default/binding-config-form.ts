import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { AtlassianToolIds } from "./tool-ids.js";

type AtlassianBindingFormContext = IntegrationFormContext;

export function resolveAtlassianBindingConfigForm(
  _input: AtlassianBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [],
          items: {
            oneOf: [
              {
                const: AtlassianToolIds.JIRA_CLI,
                title: "Jira CLI (jira)",
              },
            ],
          },
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
