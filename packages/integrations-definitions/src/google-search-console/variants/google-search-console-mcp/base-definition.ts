import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type GoogleSearchConsoleConnectionConfig,
  GoogleSearchConsoleConnectionConfigSchema,
  GoogleSearchConsoleConnectionStartConfigSchema,
  GoogleSearchConsoleFamilyId,
  GoogleSearchConsoleMcpVariantId,
} from "./auth.js";
import { resolveGoogleSearchConsoleBindingConfigForm } from "./binding-config-form.js";
import { GoogleSearchConsoleBindingConfigSchema } from "./binding-config-schema.js";
import { compileGoogleSearchConsoleBinding, GoogleSearchConsoleMcpUrl } from "./compile-binding.js";
import { GoogleSearchConsoleTargetConfigSchema } from "./target-config-schema.js";
import { GoogleSearchConsoleTargetSecretSchema } from "./target-secret-schema.js";
import { GoogleSearchConsoleToolIds } from "./tool-ids.js";

export type GoogleSearchConsoleMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof GoogleSearchConsoleTargetConfigSchema,
  typeof GoogleSearchConsoleTargetSecretSchema,
  typeof GoogleSearchConsoleBindingConfigSchema,
  GoogleSearchConsoleConnectionConfig
>;

export const GoogleSearchConsoleMcpBaseDefinition: GoogleSearchConsoleMcpBaseIntegrationDefinition =
  {
    familyId: GoogleSearchConsoleFamilyId,
    variantId: GoogleSearchConsoleMcpVariantId,
    kind: IntegrationKinds.CONNECTOR,
    displayName: "Google Search Console",
    description: "Enable Google Search Console search performance and indexing access in sandbox.",
    logoKey: "google-search-console",
    targetConfigSchema: GoogleSearchConsoleTargetConfigSchema,
    targetSecretSchema: GoogleSearchConsoleTargetSecretSchema,
    bindingConfigSchema: GoogleSearchConsoleBindingConfigSchema,
    bindingConfigForm: resolveGoogleSearchConsoleBindingConfigForm,
    connectionMethods: [
      {
        id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        label: "Google OAuth",
        kind: "redirect",
        configSchema: GoogleSearchConsoleConnectionConfigSchema,
        startConfigSchema: GoogleSearchConsoleConnectionStartConfigSchema,
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
            submitLabel: "Connect Google Search Console",
            helperText:
              "Authorize read-only Google Search Console access with your Google OAuth client.",
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
      input.binding.config.tools.includes(GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_MCP)
        ? [
            {
              serverId: GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_MCP,
              serverName: "google_search_console",
              transport: IntegrationMcpTransports.STREAMABLE_HTTP,
              url: GoogleSearchConsoleMcpUrl,
              description: "Google Search Console MCP",
            },
          ]
        : [],
    compileBinding: compileGoogleSearchConsoleBinding,
  };
