import {
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  ShopifyConnectionConfigSchema,
  ShopifyConnectionMethodIds,
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
      configSchema: ShopifyConnectionConfigSchema,
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
