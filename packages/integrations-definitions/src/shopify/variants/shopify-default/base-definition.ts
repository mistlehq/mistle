import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  ShopifyConnectionMethodIds,
  ShopifyCustomAppClientCredentialsConnectionConfigSchema,
  ShopifyOAuth2AuthorizationCodeConnectionConfigSchema,
  ShopifyOAuth2AuthorizationCodeConnectionStartConfigSchema,
  type ShopifyConnectionConfig,
  ShopifyCredentialSecretTypes,
  ShopifyCredentialSlotKeys,
  ShopifyDefaultVariantId,
  ShopifyFamilyId,
} from "./auth.js";
import { resolveShopifyBindingConfigForm } from "./binding-config-form.js";
import { ShopifyBindingConfigSchema } from "./binding-config-schema.js";
import { compileShopifyBinding, ShopifyMcpUrl } from "./compile-binding.js";
import { ShopifyCustomAppClientCredentialsConnectionConfigForm } from "./connection-config-form.js";
import { ShopifyTargetConfigSchema } from "./target-config-schema.js";
import { ShopifyTargetSecretSchema } from "./target-secret-schema.js";
import { ShopifyToolIds } from "./tool-ids.js";

export type ShopifyBaseIntegrationDefinition = IntegrationDefinition<
  typeof ShopifyTargetConfigSchema,
  typeof ShopifyTargetSecretSchema,
  typeof ShopifyBindingConfigSchema,
  ShopifyConnectionConfig
>;

export const ShopifyBaseDefinition: ShopifyBaseIntegrationDefinition = {
  familyId: ShopifyFamilyId,
  variantId: ShopifyDefaultVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Shopify",
  description: "Enable Shopify Admin API access in sandbox.",
  logoKey: "shopify",
  targetConfigSchema: ShopifyTargetConfigSchema,
  targetSecretSchema: ShopifyTargetSecretSchema,
  bindingConfigSchema: ShopifyBindingConfigSchema,
  bindingConfigForm: resolveShopifyBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Custom distribution OAuth",
      kind: "redirect",
      configSchema: ShopifyOAuth2AuthorizationCodeConnectionConfigSchema,
      startConfigSchema: ShopifyOAuth2AuthorizationCodeConnectionStartConfigSchema,
      startConfigForm: () => ({
        schema: {
          type: "object",
          properties: {
            shop_domain: {
              type: "string",
              title: "Shop domain",
            },
            admin_api_version: {
              type: "string",
              title: "Admin API version",
              default: "2026-04",
            },
            client_id: {
              type: "string",
              title: "Client ID",
            },
            client_secret: {
              type: "string",
              title: "Client secret",
            },
          },
          required: ["shop_domain", "admin_api_version", "client_id", "client_secret"],
        },
        uiSchema: {
          shop_domain: {
            "ui:placeholder": "example.myshopify.com",
          },
          admin_api_version: {
            "ui:placeholder": "2026-04",
          },
          client_secret: {
            "ui:widget": "password",
          },
        },
      }),
      ui: {
        create: {
          submitLabel: "Connect Shopify",
          helperText: "Authorize Shopify Admin API access with your custom distribution app.",
          showCallbackUrl: true,
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
    {
      id: ShopifyConnectionMethodIds.CUSTOM_APP_CLIENT_CREDENTIALS,
      label: "Custom app client credentials",
      kind: "form",
      secretFields: [
        {
          name: "clientSecret",
          label: "Client secret",
          placeholder: "Enter Shopify custom app client secret",
          inputType: "password",
          secretType: ShopifyCredentialSecretTypes.OAUTH2_CLIENT_SECRET,
          slotKey: ShopifyCredentialSlotKeys.CUSTOM_APP_CLIENT_CREDENTIALS_CLIENT_SECRET,
        },
      ],
      configSchema: ShopifyCustomAppClientCredentialsConnectionConfigSchema,
      configForm: ShopifyCustomAppClientCredentialsConnectionConfigForm,
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(ShopifyToolIds.SHOPIFY_MCP)
      ? [
          {
            serverId: ShopifyToolIds.SHOPIFY_MCP,
            serverName: "shopify",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: ShopifyMcpUrl,
            description: "Shopify MCP",
          },
        ]
      : [],
  compileBinding: compileShopifyBinding,
};
