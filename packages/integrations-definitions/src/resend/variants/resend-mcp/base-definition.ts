import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type ResendConnectionConfig,
  ResendConnectionConfigSchema,
  ResendCredentialSecretTypes,
  ResendCredentialSlotKeys,
} from "./auth.js";
import {
  ResendConnectionConfigForm,
  resolveResendBindingConfigForm,
} from "./binding-config-form.js";
import { ResendBindingConfigSchema } from "./binding-config-schema.js";
import { compileResendBinding, ResendMcpWrapperPath } from "./compile-binding.js";
import { ResendTargetConfigSchema } from "./target-config-schema.js";
import { ResendTargetSecretSchema } from "./target-secret-schema.js";
import { ResendToolIds } from "./tool-ids.js";

export type ResendMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof ResendTargetConfigSchema,
  typeof ResendTargetSecretSchema,
  typeof ResendBindingConfigSchema,
  ResendConnectionConfig
>;

export const ResendMcpBaseDefinition: ResendMcpBaseIntegrationDefinition = {
  familyId: "resend",
  variantId: "resend-mcp",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Resend",
  description: "Enable Resend MCP access for email, contacts, broadcasts, domains, and webhooks.",
  logoKey: "resend",
  targetConfigSchema: ResendTargetConfigSchema,
  targetSecretSchema: ResendTargetSecretSchema,
  bindingConfigSchema: ResendBindingConfigSchema,
  bindingConfigForm: resolveResendBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          description:
            "Resend API key used through managed egress. Prefer a sending_access key unless the agent should manage the wider Resend account.",
          placeholder: "Enter API key",
          inputType: "password",
          secretType: ResendCredentialSecretTypes.API_KEY,
          slotKey: ResendCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: ResendConnectionConfigSchema,
      configForm: ResendConnectionConfigForm,
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(ResendToolIds.RESEND_MCP)
      ? [
          {
            serverId: ResendToolIds.RESEND_MCP,
            serverName: "resend",
            transport: IntegrationMcpTransports.STDIO,
            command: ResendMcpWrapperPath,
            description: "Resend MCP tools backed by the Resend connection.",
          },
        ]
      : [],
  compileBinding: compileResendBinding,
};
