import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  KlaviyoFamilyId,
  type KlaviyoConnectionConfig,
  KlaviyoConnectionConfigSchema,
  KlaviyoMcpUrl,
  KlaviyoMcpVariantId,
} from "./auth.js";
import { resolveKlaviyoBindingConfigForm } from "./binding-config-form.js";
import { KlaviyoBindingConfigSchema } from "./binding-config-schema.js";
import { compileKlaviyoBinding } from "./compile-binding.js";
import { KlaviyoTargetConfigSchema } from "./target-config-schema.js";
import { KlaviyoTargetSecretSchema } from "./target-secret-schema.js";
import { KlaviyoToolIds } from "./tool-ids.js";

export type KlaviyoMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof KlaviyoTargetConfigSchema,
  typeof KlaviyoTargetSecretSchema,
  typeof KlaviyoBindingConfigSchema,
  KlaviyoConnectionConfig
>;

export const KlaviyoMcpBaseDefinition: KlaviyoMcpBaseIntegrationDefinition = {
  familyId: KlaviyoFamilyId,
  variantId: KlaviyoMcpVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Klaviyo",
  description: "Enable Klaviyo hosted MCP access for campaigns, flows, profiles, and reporting.",
  logoKey: "klaviyo",
  targetConfigSchema: KlaviyoTargetConfigSchema,
  targetSecretSchema: KlaviyoTargetSecretSchema,
  bindingConfigSchema: KlaviyoBindingConfigSchema,
  bindingConfigForm: resolveKlaviyoBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Klaviyo OAuth",
      kind: "redirect",
      configSchema: KlaviyoConnectionConfigSchema,
      ui: {
        create: {
          submitLabel: "Connect Klaviyo",
          helperText: "Authorize Klaviyo hosted MCP access.",
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(KlaviyoToolIds.KLAVIYO_MCP)
      ? [
          {
            serverId: KlaviyoToolIds.KLAVIYO_MCP,
            serverName: "klaviyo",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: KlaviyoMcpUrl,
            description: "Klaviyo MCP",
          },
        ]
      : [],
  compileBinding: compileKlaviyoBinding,
};
