import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type SupabaseConnectionConfig,
  SupabaseConnectionConfigSchema,
  SupabaseMcpUrl,
} from "./auth.js";
import { resolveSupabaseBindingConfigForm } from "./binding-config-form.js";
import { SupabaseBindingConfigSchema } from "./binding-config-schema.js";
import { compileSupabaseBinding } from "./compile-binding.js";
import { SupabaseTargetConfigSchema } from "./target-config-schema.js";
import { SupabaseTargetSecretSchema } from "./target-secret-schema.js";
import { SupabaseToolIds } from "./tool-ids.js";

export type SupabaseMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof SupabaseTargetConfigSchema,
  typeof SupabaseTargetSecretSchema,
  typeof SupabaseBindingConfigSchema,
  SupabaseConnectionConfig
>;

export const SupabaseMcpBaseDefinition: SupabaseMcpBaseIntegrationDefinition = {
  familyId: "supabase",
  variantId: "supabase-mcp",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Supabase",
  description:
    "Enable Supabase hosted MCP access for projects, databases, Auth, and Edge Functions.",
  logoKey: "supabase",
  targetConfigSchema: SupabaseTargetConfigSchema,
  targetSecretSchema: SupabaseTargetSecretSchema,
  bindingConfigSchema: SupabaseBindingConfigSchema,
  bindingConfigForm: resolveSupabaseBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Supabase MCP OAuth",
      kind: "redirect",
      configSchema: SupabaseConnectionConfigSchema,
      ui: {
        create: {
          submitLabel: "Connect Supabase",
          helperText: "Authorize Supabase hosted MCP access.",
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(SupabaseToolIds.SUPABASE_MCP)
      ? [
          {
            serverId: SupabaseToolIds.SUPABASE_MCP,
            serverName: "supabase",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: SupabaseMcpUrl,
            description: "Supabase MCP",
          },
        ]
      : [],
  compileBinding: compileSupabaseBinding,
};
