import {
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import { JiraConnectionConfigSchema, JiraSupportedAuthSchemes } from "./auth.js";
import { JiraBindingConfigSchema } from "./binding-config-schema.js";
import { compileJiraBinding } from "./compile-binding.js";
import { JiraConnectionConfigForm } from "./connection-config-form.js";
import { JiraTargetConfigSchema } from "./target-config-schema.js";

type JiraIntegrationDefinition = IntegrationDefinition<
  typeof JiraTargetConfigSchema,
  typeof JiraTargetSecretSchema,
  typeof JiraBindingConfigSchema,
  typeof JiraConnectionConfigSchema
>;

const JiraTargetSecretSchema = z.object({}).strict();

export const JiraDefinition: JiraIntegrationDefinition = {
  familyId: "jira",
  variantId: "jira-default",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Jira",
  description: "Expose Atlassian's remote Jira MCP server to sandbox agents through Mistle egress.",
  logoKey: "jira",
  targetConfigSchema: JiraTargetConfigSchema,
  targetSecretSchema: JiraTargetSecretSchema,
  bindingConfigSchema: JiraBindingConfigSchema,
  connectionConfigSchema: JiraConnectionConfigSchema,
  connectionConfigForm: JiraConnectionConfigForm,
  supportedAuthSchemes: JiraSupportedAuthSchemes,
  mcp: () => ({
    serverId: "jira-default",
    serverName: "jira",
    transport: IntegrationMcpTransports.STREAMABLE_HTTP,
    url: "https://mcp.atlassian.com/v1/mcp",
    description: "Jira MCP",
  }),
  compileBinding: compileJiraBinding,
};
