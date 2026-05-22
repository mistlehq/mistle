import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import { resolveRemoteMcpServers } from "../../../shared/remote-mcp-server-catalog/index.js";
import {
  type GcpConnectionConfig,
  GcpConnectionConfigSchema,
  GcpConnectionStartConfigSchema,
} from "./auth.js";
import { resolveGcpBindingConfigForm } from "./binding-config-form.js";
import { GcpBindingConfigSchema } from "./binding-config-schema.js";
import { compileGcpBinding } from "./compile-binding.js";
import { GcpMcpServerCatalog } from "./mcp-catalog.js";
import { GcpTargetConfigSchema } from "./target-config-schema.js";
import { GcpTargetSecretSchema } from "./target-secret-schema.js";

export type GcpMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof GcpTargetConfigSchema,
  typeof GcpTargetSecretSchema,
  typeof GcpBindingConfigSchema,
  GcpConnectionConfig
>;

export const GcpMcpBaseDefinition: GcpMcpBaseIntegrationDefinition = {
  familyId: "gcp",
  variantId: "gcp-mcp",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Google Cloud",
  description: "Enable Google-hosted MCP access for Google Cloud services.",
  logoKey: "gcp",
  targetConfigSchema: GcpTargetConfigSchema,
  targetSecretSchema: GcpTargetSecretSchema,
  bindingConfigSchema: GcpBindingConfigSchema,
  bindingConfigForm: resolveGcpBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Google OAuth",
      kind: "redirect",
      configSchema: GcpConnectionConfigSchema,
      startConfigSchema: GcpConnectionStartConfigSchema,
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
          submitLabel: "Connect Google Cloud",
          helperText: "Authorize Google Cloud access with your Google OAuth client.",
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
    resolveRemoteMcpServers({
      catalog: GcpMcpServerCatalog,
      selectedIds: input.binding.config.mcpServers,
    }),
  compileBinding: compileGcpBinding,
};
