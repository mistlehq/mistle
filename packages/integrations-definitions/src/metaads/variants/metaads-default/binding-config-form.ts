import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { MetaAdsToolIds } from "./tool-ids.js";

type MetaAdsBindingFormContext = IntegrationFormContext;

export function resolveMetaAdsBindingConfigForm(
  _input: MetaAdsBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [MetaAdsToolIds.METAADS_MCP],
          items: {
            type: "string",
            enum: [MetaAdsToolIds.METAADS_CLI, MetaAdsToolIds.METAADS_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Meta Ads CLI", "Meta Ads MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
