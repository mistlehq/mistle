import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type RenderConnectionConfig,
  RenderConnectionConfigSchema,
  RenderCredentialSecretTypes,
  RenderCredentialSlotKeys,
} from "./auth.js";
import { resolveRenderBindingConfigForm } from "./binding-config-form.js";
import { RenderBindingConfigSchema } from "./binding-config-schema.js";
import { compileRenderBinding } from "./compile-binding.js";
import { RenderConnectionConfigForm } from "./connection-config-form.js";
import { resolveRenderMcpUrl, RenderTargetConfigSchema } from "./target-config-schema.js";
import { RenderToolIds } from "./tool-ids.js";

type RenderIntegrationDefinition = IntegrationDefinition<
  typeof RenderTargetConfigSchema,
  typeof RenderTargetSecretSchema,
  typeof RenderBindingConfigSchema,
  RenderConnectionConfig
>;

const RenderTargetSecretSchema = z.object({}).strict();

export const RenderDefinition: RenderIntegrationDefinition = {
  familyId: "render",
  variantId: "render-mcp",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Render",
  description: "Enable Render hosted MCP access for services, databases, logs, and metrics.",
  logoKey: "render",
  targetConfigSchema: RenderTargetConfigSchema,
  targetSecretSchema: RenderTargetSecretSchema,
  bindingConfigSchema: RenderBindingConfigSchema,
  bindingConfigForm: resolveRenderBindingConfigForm,
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
          secretType: RenderCredentialSecretTypes.API_KEY,
          slotKey: RenderCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: RenderConnectionConfigSchema,
      configForm: RenderConnectionConfigForm,
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(RenderToolIds.RENDER_MCP)
      ? [
          {
            serverId: RenderToolIds.RENDER_MCP,
            serverName: "render",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: resolveRenderMcpUrl(),
            description: "Render MCP",
          },
        ]
      : [],
  compileBinding: compileRenderBinding,
};
