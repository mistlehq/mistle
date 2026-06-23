import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type GoogleBusinessProfileConnectionConfig,
  GoogleBusinessProfileConnectionConfigSchema,
  GoogleBusinessProfileConnectionStartConfigSchema,
  GoogleBusinessProfileFamilyId,
  GoogleBusinessProfileMcpVariantId,
} from "./auth.js";
import { resolveGoogleBusinessProfileBindingConfigForm } from "./binding-config-form.js";
import { GoogleBusinessProfileBindingConfigSchema } from "./binding-config-schema.js";
import {
  compileGoogleBusinessProfileBinding,
  GoogleBusinessProfileMcpUrl,
} from "./compile-binding.js";
import { GoogleBusinessProfileTargetConfigSchema } from "./target-config-schema.js";
import { GoogleBusinessProfileTargetSecretSchema } from "./target-secret-schema.js";
import { GoogleBusinessProfileToolIds } from "./tool-ids.js";

export type GoogleBusinessProfileMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof GoogleBusinessProfileTargetConfigSchema,
  typeof GoogleBusinessProfileTargetSecretSchema,
  typeof GoogleBusinessProfileBindingConfigSchema,
  GoogleBusinessProfileConnectionConfig
>;

export const GoogleBusinessProfileMcpBaseDefinition: GoogleBusinessProfileMcpBaseIntegrationDefinition =
  {
    familyId: GoogleBusinessProfileFamilyId,
    variantId: GoogleBusinessProfileMcpVariantId,
    kind: IntegrationKinds.CONNECTOR,
    displayName: "Google Business Profile",
    description: "Enable Google Business Profile management and performance access in sandbox.",
    logoKey: "google-business-profile",
    targetConfigSchema: GoogleBusinessProfileTargetConfigSchema,
    targetSecretSchema: GoogleBusinessProfileTargetSecretSchema,
    bindingConfigSchema: GoogleBusinessProfileBindingConfigSchema,
    bindingConfigForm: resolveGoogleBusinessProfileBindingConfigForm,
    connectionMethods: [
      {
        id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        label: "Google OAuth",
        kind: "redirect",
        configSchema: GoogleBusinessProfileConnectionConfigSchema,
        startConfigSchema: GoogleBusinessProfileConnectionStartConfigSchema,
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
            submitLabel: "Connect Google Business Profile",
            helperText: "Authorize Google Business Profile access with your Google OAuth client.",
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
      input.binding.config.tools.includes(GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_MCP)
        ? [
            {
              serverId: GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_MCP,
              serverName: "google_business_profile",
              transport: IntegrationMcpTransports.STREAMABLE_HTTP,
              url: GoogleBusinessProfileMcpUrl,
              description: "Google Business Profile MCP",
            },
          ]
        : [],
    compileBinding: compileGoogleBusinessProfileBinding,
  };
