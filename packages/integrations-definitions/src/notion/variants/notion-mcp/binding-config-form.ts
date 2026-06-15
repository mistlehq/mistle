import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { NotionToolIds } from "./tool-ids.js";

type NotionBindingFormContext = IntegrationFormContext;

export function resolveNotionBindingConfigForm(
  _input: NotionBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [NotionToolIds.NOTION_MCP],
          items: {
            type: "string",
            enum: [NotionToolIds.NOTION_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Notion MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
