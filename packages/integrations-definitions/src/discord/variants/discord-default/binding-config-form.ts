import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { DiscordToolIds } from "./tool-ids.js";

type DiscordBindingFormContext = IntegrationFormContext;

export function resolveDiscordBindingConfigForm(
  _input: DiscordBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [],
          items: {
            type: "string",
            enum: [DiscordToolIds.DISCORD_CLI, DiscordToolIds.DISCORD_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Discord CLI", "Discord MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
