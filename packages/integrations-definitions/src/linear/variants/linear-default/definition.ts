import {
  IntegrationConnectionMethodIds,
  IntegrationConnectionMethodKinds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import { type LinearConnectionConfig, LinearConnectionConfigSchema } from "./auth.js";
import { LinearBindingConfigSchema } from "./binding-config-schema.js";
import { compileLinearBinding } from "./compile-binding.js";
import { LinearConnectionConfigForm } from "./connection-config-form.js";
import { LinearTargetConfigSchema } from "./target-config-schema.js";

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
  description: "Expose Linear's remote MCP server to sandbox agents through Mistle egress.",
  logoKey: "linear",
  targetConfigSchema: LinearTargetConfigSchema,
  targetSecretSchema: LinearTargetSecretSchema,
  bindingConfigSchema: LinearBindingConfigSchema,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: IntegrationConnectionMethodKinds.API_KEY,
      configSchema: LinearConnectionConfigSchema,
      configForm: LinearConnectionConfigForm,
    },
  ],
  mcp: () => ({
    serverId: "linear-default",
    serverName: "linear",
    transport: IntegrationMcpTransports.STREAMABLE_HTTP,
    url: "https://mcp.linear.app/mcp",
    description: "Linear MCP",
  }),
  compileBinding: compileLinearBinding,
};
