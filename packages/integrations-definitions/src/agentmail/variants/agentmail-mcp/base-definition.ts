import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  AgentMailFamilyId,
  type AgentMailConnectionConfig,
  AgentMailConnectionConfigSchema,
  AgentMailMcpUrl,
  AgentMailMcpVariantId,
} from "./auth.js";
import { resolveAgentMailBindingConfigForm } from "./binding-config-form.js";
import { AgentMailBindingConfigSchema } from "./binding-config-schema.js";
import { compileAgentMailBinding } from "./compile-binding.js";
import { AgentMailTargetConfigSchema } from "./target-config-schema.js";
import { AgentMailTargetSecretSchema } from "./target-secret-schema.js";
import { AgentMailToolIds } from "./tool-ids.js";

export type AgentMailMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof AgentMailTargetConfigSchema,
  typeof AgentMailTargetSecretSchema,
  typeof AgentMailBindingConfigSchema,
  AgentMailConnectionConfig
>;

export const AgentMailMcpBaseDefinition: AgentMailMcpBaseIntegrationDefinition = {
  familyId: AgentMailFamilyId,
  variantId: AgentMailMcpVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "AgentMail",
  description: "Enable AgentMail hosted MCP access for inboxes, threads, messages, and drafts.",
  logoKey: "agentmail",
  targetConfigSchema: AgentMailTargetConfigSchema,
  targetSecretSchema: AgentMailTargetSecretSchema,
  bindingConfigSchema: AgentMailBindingConfigSchema,
  bindingConfigForm: resolveAgentMailBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "AgentMail OAuth",
      kind: "redirect",
      configSchema: AgentMailConnectionConfigSchema,
      ui: {
        create: {
          submitLabel: "Connect AgentMail",
          helperText: "Authorize AgentMail hosted MCP access.",
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(AgentMailToolIds.AGENTMAIL_MCP)
      ? [
          {
            serverId: AgentMailToolIds.AGENTMAIL_MCP,
            serverName: "agentmail",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: AgentMailMcpUrl,
            description: "AgentMail MCP",
          },
        ]
      : [],
  compileBinding: compileAgentMailBinding,
};
