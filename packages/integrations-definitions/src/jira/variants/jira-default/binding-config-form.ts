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
          default: [JiraToolIds.JIRA_CLI],
          items: {
            type: "string",
            enum: [JiraToolIds.JIRA_CLI, JiraToolIds.JIRA_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Jira CLI", "Jira MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
