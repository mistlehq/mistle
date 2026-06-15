import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  PostHogFamilyId,
  type PostHogConnectionConfig,
  PostHogConnectionConfigSchema,
  PostHogMcpUrl,
  PostHogMcpVariantId,
} from "./auth.js";
import { resolvePostHogBindingConfigForm } from "./binding-config-form.js";
import { PostHogBindingConfigSchema } from "./binding-config-schema.js";
import { compilePostHogBinding } from "./compile-binding.js";
import { PostHogTargetConfigSchema } from "./target-config-schema.js";
import { PostHogTargetSecretSchema } from "./target-secret-schema.js";
import { PostHogToolIds } from "./tool-ids.js";

export type PostHogMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof PostHogTargetConfigSchema,
  typeof PostHogTargetSecretSchema,
  typeof PostHogBindingConfigSchema,
  PostHogConnectionConfig
>;

export const PostHogMcpBaseDefinition: PostHogMcpBaseIntegrationDefinition = {
  familyId: PostHogFamilyId,
  variantId: PostHogMcpVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "PostHog",
  description: "Enable PostHog hosted MCP access for analytics, feature flags, and errors.",
  logoKey: "posthog",
  targetConfigSchema: PostHogTargetConfigSchema,
  targetSecretSchema: PostHogTargetSecretSchema,
  bindingConfigSchema: PostHogBindingConfigSchema,
  bindingConfigForm: resolvePostHogBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "PostHog OAuth",
      kind: "redirect",
      configSchema: PostHogConnectionConfigSchema,
      ui: {
        create: {
          submitLabel: "Connect PostHog",
          helperText: "Authorize PostHog hosted MCP access.",
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(PostHogToolIds.POSTHOG_MCP)
      ? [
          {
            serverId: PostHogToolIds.POSTHOG_MCP,
            serverName: "posthog",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: PostHogMcpUrl,
            description: "PostHog MCP",
          },
        ]
      : [],
  compileBinding: compilePostHogBinding,
};
