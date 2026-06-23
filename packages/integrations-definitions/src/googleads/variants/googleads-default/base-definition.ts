import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type GoogleAdsConnectionConfig,
  GoogleAdsConnectionConfigSchema,
  GoogleAdsConnectionStartConfigSchema,
  GoogleAdsCredentialSecretTypes,
  GoogleAdsDefaultVariantId,
  GoogleAdsDeveloperTokenCredentialSlotKey,
  GoogleAdsFamilyId,
} from "./auth.js";
import { resolveGoogleAdsBindingConfigForm } from "./binding-config-form.js";
import { GoogleAdsBindingConfigSchema } from "./binding-config-schema.js";
import { compileGoogleAdsBinding, GoogleAdsMcpUrl } from "./compile-binding.js";
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
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Google OAuth",
      kind: "redirect",
      configSchema: GoogleAdsConnectionConfigSchema,
      startConfigSchema: GoogleAdsConnectionStartConfigSchema,
      reauthorizationSecretFields: [
        {
          name: "developer_token",
          slotKey: GoogleAdsDeveloperTokenCredentialSlotKey,
          secretKind: GoogleAdsCredentialSecretTypes.API_KEY,
        },
      ],
      startConfigForm: () => ({
        schema: {
          type: "object",
          properties: {
            client_id: {
              type: "string",
              title: "OAuth client ID",
            },
            client_secret: {
              type: "string",
              title: "OAuth client secret",
            },
            developer_token: {
              type: "string",
              title: "Developer token",
            },
            login_customer_id: {
              type: "string",
              title: "Login customer ID",
            },
          },
          required: ["client_id", "client_secret", "developer_token"],
        },
        uiSchema: {
          client_id: {
            "ui:placeholder": "1234567890-abc.apps.googleusercontent.com",
          },
          client_secret: {
            "ui:widget": "password",
          },
          developer_token: {
            "ui:widget": "password",
          },
          login_customer_id: {
            "ui:placeholder": "1234567890",
          },
        },
      }),
      ui: {
        create: {
          submitLabel: "Connect Google Ads",
          helperText: "Authorize Google Ads API access with your Google OAuth client.",
          showCallbackUrl: true,
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
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
