import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type GoogleAnalyticsConnectionConfig,
  GoogleAnalyticsConnectionConfigSchema,
  GoogleAnalyticsConnectionStartConfigSchema,
  GoogleAnalyticsFamilyId,
  GoogleAnalyticsMcpVariantId,
} from "./auth.js";
import { resolveGoogleAnalyticsBindingConfigForm } from "./binding-config-form.js";
import { GoogleAnalyticsBindingConfigSchema } from "./binding-config-schema.js";
import { compileGoogleAnalyticsBinding, GoogleAnalyticsMcpUrl } from "./compile-binding.js";
import { GoogleAnalyticsTargetConfigSchema } from "./target-config-schema.js";
import { GoogleAnalyticsTargetSecretSchema } from "./target-secret-schema.js";
import { GoogleAnalyticsToolIds } from "./tool-ids.js";

export type GoogleAnalyticsMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof GoogleAnalyticsTargetConfigSchema,
  typeof GoogleAnalyticsTargetSecretSchema,
  typeof GoogleAnalyticsBindingConfigSchema,
  GoogleAnalyticsConnectionConfig
>;

export const GoogleAnalyticsMcpBaseDefinition: GoogleAnalyticsMcpBaseIntegrationDefinition = {
  familyId: GoogleAnalyticsFamilyId,
  variantId: GoogleAnalyticsMcpVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Google Analytics",
  description: "Enable Google Analytics 4 reporting and metadata access in sandbox.",
  logoKey: "google-analytics",
  targetConfigSchema: GoogleAnalyticsTargetConfigSchema,
  targetSecretSchema: GoogleAnalyticsTargetSecretSchema,
  bindingConfigSchema: GoogleAnalyticsBindingConfigSchema,
  bindingConfigForm: resolveGoogleAnalyticsBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Google OAuth",
      kind: "redirect",
      configSchema: GoogleAnalyticsConnectionConfigSchema,
      startConfigSchema: GoogleAnalyticsConnectionStartConfigSchema,
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
          },
          required: ["client_id", "client_secret"],
        },
        uiSchema: {
          client_id: {
            "ui:placeholder": "1234567890-abc.apps.googleusercontent.com",
          },
          client_secret: {
            "ui:widget": "password",
          },
        },
      }),
      ui: {
        create: {
          submitLabel: "Connect Google Analytics",
          helperText: "Authorize read-only Google Analytics access with your Google OAuth client.",
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
    input.binding.config.tools.includes(GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_MCP)
      ? [
          {
            serverId: GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_MCP,
            serverName: "google_analytics",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: GoogleAnalyticsMcpUrl,
            description: "Google Analytics MCP",
          },
        ]
      : [],
  compileBinding: compileGoogleAnalyticsBinding,
};
