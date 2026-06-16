import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import { type StripeConnectionConfig, StripeConnectionConfigSchema, StripeMcpUrl } from "./auth.js";
import { resolveStripeBindingConfigForm } from "./binding-config-form.js";
import { StripeBindingConfigSchema } from "./binding-config-schema.js";
import { compileStripeBinding } from "./compile-binding.js";
import { StripeTargetConfigSchema } from "./target-config-schema.js";
import { StripeTargetSecretSchema } from "./target-secret-schema.js";
import { StripeToolIds } from "./tool-ids.js";

export type StripeMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof StripeTargetConfigSchema,
  typeof StripeTargetSecretSchema,
  typeof StripeBindingConfigSchema,
  StripeConnectionConfig
>;

export const StripeMcpBaseDefinition: StripeMcpBaseIntegrationDefinition = {
  familyId: "stripe",
  variantId: "stripe-mcp",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Stripe",
  description:
    "Enable Stripe hosted MCP access for customers, invoices, products, payments, and documentation.",
  logoKey: "stripe",
  targetConfigSchema: StripeTargetConfigSchema,
  targetSecretSchema: StripeTargetSecretSchema,
  bindingConfigSchema: StripeBindingConfigSchema,
  bindingConfigForm: resolveStripeBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Stripe MCP OAuth",
      kind: "redirect",
      configSchema: StripeConnectionConfigSchema,
      ui: {
        create: {
          submitLabel: "Connect Stripe",
          helperText: "Authorize Stripe hosted MCP access.",
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(StripeToolIds.STRIPE_MCP)
      ? [
          {
            serverId: StripeToolIds.STRIPE_MCP,
            serverName: "stripe",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: StripeMcpUrl,
            description: "Stripe MCP",
          },
        ]
      : [],
  compileBinding: compileStripeBinding,
};
