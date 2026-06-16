import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { AgentMailToolIds } from "./tool-ids.js";

type AgentMailBindingFormContext = IntegrationFormContext;

export function resolveAgentMailBindingConfigForm(
  _input: AgentMailBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [AgentMailToolIds.AGENTMAIL_MCP],
          items: {
            type: "string",
            enum: [AgentMailToolIds.AGENTMAIL_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["AgentMail MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
