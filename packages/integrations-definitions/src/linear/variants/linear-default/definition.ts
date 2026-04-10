import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type LinearConnectionConfig,
  LinearConnectionConfigSchema,
  LinearCredentialSlotKeys,
} from "./auth.js";
import { resolveLinearBindingConfigForm } from "./binding-config-form.js";
import { LinearBindingConfigSchema } from "./binding-config-schema.js";
import { compileLinearBinding } from "./compile-binding.js";
import { LinearConnectionConfigForm } from "./connection-config-form.js";
import { LinearTargetConfigSchema } from "./target-config-schema.js";
import { LinearToolIds } from "./tool-ids.js";

type LinearIntegrationDefinition = IntegrationDefinition<
  typeof LinearTargetConfigSchema,
  typeof LinearTargetSecretSchema,
  typeof LinearBindingConfigSchema,
  LinearConnectionConfig
>;

const LinearTargetSecretSchema = z.object({}).strict();

export const LinearDefinition: LinearIntegrationDefinition = {
  familyId: "linear",
  variantId: "linear-default",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Linear",
  description: "Enable access to Linear issues, projects, and workflows from agents.",
  logoKey: "linear",
  targetConfigSchema: LinearTargetConfigSchema,
  targetSecretSchema: LinearTargetSecretSchema,
  bindingConfigSchema: LinearBindingConfigSchema,
  bindingConfigForm: resolveLinearBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          placeholder: "Enter API key",
          inputType: "password",
          secretType: "api_key",
          slotKey: LinearCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: LinearConnectionConfigSchema,
      configForm: LinearConnectionConfigForm,
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(LinearToolIds.LINEAR_MCP)
      ? [
          {
            serverId: "linear-default",
            serverName: "linear",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: "https://mcp.linear.app/mcp",
            description: "Linear MCP",
          },
        ]
      : [],
  compileBinding: compileLinearBinding,
};
