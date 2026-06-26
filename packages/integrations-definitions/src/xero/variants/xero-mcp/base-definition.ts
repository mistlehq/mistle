import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type XeroConnectionConfig,
  XeroConnectionConfigSchema,
  XeroConnectionStartConfigSchema,
  XeroFamilyId,
  XeroMcpVariantId,
} from "./auth.js";
import {
  resolveXeroBindingConfigForm,
  XeroConnectionStartConfigForm,
} from "./binding-config-form.js";
import { XeroBindingConfigSchema } from "./binding-config-schema.js";
import { compileXeroBinding, XeroMcpUrl } from "./compile-binding.js";
import { XeroTargetConfigSchema } from "./target-config-schema.js";
import { XeroTargetSecretSchema } from "./target-secret-schema.js";
import { XeroToolIds } from "./tool-ids.js";

export type XeroMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof XeroTargetConfigSchema,
  typeof XeroTargetSecretSchema,
  typeof XeroBindingConfigSchema,
  XeroConnectionConfig
>;

export const XeroMcpBaseDefinition: XeroMcpBaseIntegrationDefinition = {
  familyId: XeroFamilyId,
  variantId: XeroMcpVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Xero",
  description: "Enable Xero API access through Mistle's Xero MCP tools.",
  logoKey: "xero",
  targetConfigSchema: XeroTargetConfigSchema,
  targetSecretSchema: XeroTargetSecretSchema,
  bindingConfigSchema: XeroBindingConfigSchema,
  bindingConfigForm: resolveXeroBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Xero OAuth",
      kind: "redirect",
      configSchema: XeroConnectionConfigSchema,
      startConfigSchema: XeroConnectionStartConfigSchema,
      startConfigForm: () => XeroConnectionStartConfigForm,
      ui: {
        create: {
          submitLabel: "Connect Xero",
          helperText: "Authorize Xero access with your Xero OAuth app.",
          showCallbackUrl: true,
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(XeroToolIds.XERO_MCP)
      ? [
          {
            serverId: XeroToolIds.XERO_MCP,
            serverName: "xero",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: XeroMcpUrl,
            description: "Xero MCP tools backed by direct Xero API calls.",
          },
        ]
      : [],
  compileBinding: compileXeroBinding,
};
