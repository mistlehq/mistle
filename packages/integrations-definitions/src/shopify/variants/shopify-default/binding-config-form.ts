import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { ShopifyToolIds } from "./tool-ids.js";

type ShopifyBindingFormContext = IntegrationFormContext;

export function resolveShopifyBindingConfigForm(
  _input: ShopifyBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [ShopifyToolIds.SHOPIFY_MCP],
          items: {
            type: "string",
            enum: [ShopifyToolIds.SHOPIFY_CLI, ShopifyToolIds.SHOPIFY_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Shopify CLI", "Shopify MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
