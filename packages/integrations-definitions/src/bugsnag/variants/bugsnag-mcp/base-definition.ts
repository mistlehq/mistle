import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  BugSnagFamilyId,
  type BugSnagConnectionConfig,
  BugSnagConnectionConfigSchema,
  BugSnagMcpVariantId,
  BugSnagMcpUrl,
} from "./auth.js";
import { resolveBugSnagBindingConfigForm } from "./binding-config-form.js";
import { BugSnagBindingConfigSchema } from "./binding-config-schema.js";
import { compileBugSnagBinding } from "./compile-binding.js";
import { BugSnagTargetConfigSchema } from "./target-config-schema.js";
import { BugSnagTargetSecretSchema } from "./target-secret-schema.js";
import { BugSnagToolIds } from "./tool-ids.js";

export type BugSnagMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof BugSnagTargetConfigSchema,
  typeof BugSnagTargetSecretSchema,
  typeof BugSnagBindingConfigSchema,
  BugSnagConnectionConfig
>;

export const BugSnagMcpBaseDefinition: BugSnagMcpBaseIntegrationDefinition = {
  familyId: BugSnagFamilyId,
  variantId: BugSnagMcpVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "BugSnag",
  description: "Enable SmartBear hosted BugSnag MCP access for errors and performance data.",
  logoKey: "bugsnag",
  targetConfigSchema: BugSnagTargetConfigSchema,
  targetSecretSchema: BugSnagTargetSecretSchema,
  bindingConfigSchema: BugSnagBindingConfigSchema,
  bindingConfigForm: resolveBugSnagBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "BugSnag OAuth",
      kind: "redirect",
      configSchema: BugSnagConnectionConfigSchema,
      ui: {
        create: {
          submitLabel: "Connect BugSnag",
          helperText: "Authorize SmartBear hosted BugSnag MCP access.",
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(BugSnagToolIds.BUGSNAG_MCP)
      ? [
          {
            serverId: BugSnagToolIds.BUGSNAG_MCP,
            serverName: "bugsnag",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: BugSnagMcpUrl,
            description: "BugSnag MCP",
          },
        ]
      : [],
  compileBinding: compileBugSnagBinding,
};
