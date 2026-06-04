import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { SlackToolIds } from "./tool-ids.js";

type SlackBindingFormContext = IntegrationFormContext;

export function resolveSlackBindingConfigForm(
  _input: SlackBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [SlackToolIds.SLACK_CLI],
          items: {
            type: "string",
            enum: [SlackToolIds.SLACK_CLI, SlackToolIds.SLACK_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Slack CLI", "Slack MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
