import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { JiraToolIds } from "./tool-ids.js";

type JiraBindingFormContext = IntegrationFormContext;

export function resolveJiraBindingConfigForm(
  _input: JiraBindingFormContext,
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
                const: JiraToolIds.JIRA_CLI,
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
