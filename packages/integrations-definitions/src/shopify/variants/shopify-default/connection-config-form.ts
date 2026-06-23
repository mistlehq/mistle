import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

export const ShopifyCustomAppClientCredentialsConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        type: "string",
        title: "Connection method",
        default: "shopify-custom-app-client-credentials",
      },
      shop_domain: {
        type: "string",
        title: "Shop domain",
      },
      admin_api_version: {
        type: "string",
        title: "Admin API version",
      },
      client_id: {
        type: "string",
        title: "Client ID",
      },
    },
    required: ["connection_method", "shop_domain", "admin_api_version", "client_id"],
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
    shop_domain: {
      "ui:placeholder": "example.myshopify.com",
    },
    admin_api_version: {
      "ui:placeholder": "2026-04",
    },
    client_id: {
      "ui:placeholder": "Shopify custom app client ID",
    },
  },
};
