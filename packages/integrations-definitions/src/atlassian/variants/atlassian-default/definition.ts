import {
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import { AtlassianConnectionConfigSchema, AtlassianSupportedAuthSchemes } from "./auth.js";
import { AtlassianBindingConfigSchema } from "./binding-config-schema.js";
import { compileAtlassianBinding } from "./compile-binding.js";
import { AtlassianConnectionConfigForm } from "./connection-config-form.js";
import { AtlassianTargetConfigSchema } from "./target-config-schema.js";

type AtlassianIntegrationDefinition = IntegrationDefinition<
  typeof AtlassianTargetConfigSchema,
  typeof AtlassianTargetSecretSchema,
  typeof AtlassianBindingConfigSchema,
  typeof AtlassianConnectionConfigSchema
>;

const AtlassianTargetSecretSchema = z.object({}).strict();

export const AtlassianDefinition: AtlassianIntegrationDefinition = {
  familyId: "atlassian",
  variantId: "atlassian-default",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Atlassian",
  description: "Expose Atlassian's remote MCP server to sandbox agents through Mistle egress.",
  logoKey: "atlassian",
  targetConfigSchema: AtlassianTargetConfigSchema,
  targetSecretSchema: AtlassianTargetSecretSchema,
  bindingConfigSchema: AtlassianBindingConfigSchema,
  connectionConfigSchema: AtlassianConnectionConfigSchema,
  connectionConfigForm: AtlassianConnectionConfigForm,
  supportedAuthSchemes: AtlassianSupportedAuthSchemes,
  mcp: () => ({
    serverId: "atlassian-default",
    serverName: "atlassian",
    transport: IntegrationMcpTransports.STREAMABLE_HTTP,
    url: "https://mcp.atlassian.com/v1/mcp",
    description: "Atlassian MCP",
  }),
  compileBinding: compileAtlassianBinding,
};
