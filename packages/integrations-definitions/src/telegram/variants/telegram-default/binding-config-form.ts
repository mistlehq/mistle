import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { TelegramToolIds } from "./tool-ids.js";

type TelegramBindingFormContext = IntegrationFormContext;

export function resolveTelegramBindingConfigForm(
  _input: TelegramBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [],
          items: {
            type: "string",
            enum: [TelegramToolIds.TELEGRAM_CLI, TelegramToolIds.TELEGRAM_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Telegram CLI", "Telegram MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
