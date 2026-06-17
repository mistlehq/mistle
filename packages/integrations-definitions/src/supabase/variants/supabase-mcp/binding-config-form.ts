import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { SupabaseToolIds } from "./tool-ids.js";

type SupabaseBindingFormContext = IntegrationFormContext;

export function resolveSupabaseBindingConfigForm(
  _input: SupabaseBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [SupabaseToolIds.SUPABASE_MCP],
          items: {
            type: "string",
            enum: [SupabaseToolIds.SUPABASE_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Supabase MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
