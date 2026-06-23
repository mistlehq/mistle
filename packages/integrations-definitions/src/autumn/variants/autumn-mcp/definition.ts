import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import { resolveRemoteMcpServers } from "../../../shared/remote-mcp-server-catalog/index.js";
import {
  type AutumnConnectionConfig,
  AutumnConnectionConfigSchema,
  AutumnCredentialSecretTypes,
  AutumnCredentialSlotKeys,
} from "./auth.js";
import { resolveAutumnBindingConfigForm } from "./binding-config-form.js";
import { AutumnBindingConfigSchema } from "./binding-config-schema.js";
import { compileAutumnBinding } from "./compile-binding.js";
import { AutumnMcpServerCatalog } from "./mcp-catalog.js";
import { AutumnTargetConfigSchema } from "./target-config-schema.js";
import { AutumnTargetSecretSchema } from "./target-secret-schema.js";

export type AutumnMcpIntegrationDefinition = IntegrationDefinition<
  typeof AutumnTargetConfigSchema,
  typeof AutumnTargetSecretSchema,
  typeof AutumnBindingConfigSchema,
  AutumnConnectionConfig
>;

export const AutumnDefinition: AutumnMcpIntegrationDefinition = {
  familyId: "autumn",
  variantId: "autumn-mcp",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Autumn",
  description:
    "Enable Autumn hosted MCP access for billing, customer, plan, balance, and request-log workflows.",
  logoKey: "autumn",
  targetConfigSchema: AutumnTargetConfigSchema,
  targetSecretSchema: AutumnTargetSecretSchema,
  bindingConfigSchema: AutumnBindingConfigSchema,
  bindingConfigForm: resolveAutumnBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "Secret key",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "Autumn secret key",
          placeholder: "Enter Autumn secret key",
          description: "Use an Autumn secret key with access to the organization billing data.",
          inputType: "password",
          secretType: AutumnCredentialSecretTypes.API_KEY,
          slotKey: AutumnCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: AutumnConnectionConfigSchema,
    },
  ],
  mcp: (input) =>
    resolveRemoteMcpServers({
      catalog: AutumnMcpServerCatalog,
      selectedIds: input.binding.config.mcpServers,
    }),
  compileBinding: compileAutumnBinding,
};
