import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type GoogleAdsConnectionConfig,
  GoogleAdsConnectionConfigSchema,
  GoogleAdsCredentialSecretTypes,
  GoogleAdsCredentialSlotKeys,
  GoogleAdsDefaultVariantId,
  GoogleAdsFamilyId,
} from "./auth.js";
import { resolveGoogleAdsBindingConfigForm } from "./binding-config-form.js";
import { GoogleAdsBindingConfigSchema } from "./binding-config-schema.js";
import { compileGoogleAdsBinding, GoogleAdsMcpUrl } from "./compile-binding.js";
import { GoogleAdsConnectionConfigForm } from "./connection-config-form.js";
import { GoogleAdsTargetConfigSchema } from "./target-config-schema.js";
import { GoogleAdsTargetSecretSchema } from "./target-secret-schema.js";
import { GoogleAdsToolIds } from "./tool-ids.js";

export type GoogleAdsBaseIntegrationDefinition = IntegrationDefinition<
  typeof GoogleAdsTargetConfigSchema,
  typeof GoogleAdsTargetSecretSchema,
  typeof GoogleAdsBindingConfigSchema,
  GoogleAdsConnectionConfig
>;

export const GoogleAdsBaseDefinition: GoogleAdsBaseIntegrationDefinition = {
  familyId: GoogleAdsFamilyId,
  variantId: GoogleAdsDefaultVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Google Ads",
  description: "Enable Google Ads API access in sandbox.",
  logoKey: "googleads",
  targetConfigSchema: GoogleAdsTargetConfigSchema,
  targetSecretSchema: GoogleAdsTargetSecretSchema,
  bindingConfigSchema: GoogleAdsBindingConfigSchema,
  bindingConfigForm: resolveGoogleAdsBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "Access token",
      kind: "form",
      secretFields: [
        {
          name: "accessToken",
          label: "OAuth access token",
          placeholder: "Enter Google OAuth access token",
          inputType: "password",
          secretType: GoogleAdsCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleAdsCredentialSlotKeys.ACCESS_TOKEN,
        },
        {
          name: "developerToken",
          label: "Developer token",
          placeholder: "Enter Google Ads developer token",
          inputType: "password",
          secretType: GoogleAdsCredentialSecretTypes.API_KEY,
          slotKey: GoogleAdsCredentialSlotKeys.DEVELOPER_TOKEN,
        },
      ],
      configSchema: GoogleAdsConnectionConfigSchema,
      configForm: GoogleAdsConnectionConfigForm,
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(GoogleAdsToolIds.GOOGLEADS_MCP)
      ? [
          {
            serverId: GoogleAdsToolIds.GOOGLEADS_MCP,
            serverName: "googleads",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: GoogleAdsMcpUrl,
            description: "Google Ads MCP",
          },
        ]
      : [],
  compileBinding: compileGoogleAdsBinding,
};
