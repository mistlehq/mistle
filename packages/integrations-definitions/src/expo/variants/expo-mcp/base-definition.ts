import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import { resolveRemoteMcpServers } from "../../../shared/remote-mcp-server-catalog/index.js";
import { type ExpoConnectionConfig, ExpoConnectionConfigSchema } from "./auth.js";
import { resolveExpoBindingConfigForm } from "./binding-config-form.js";
import { ExpoBindingConfigSchema } from "./binding-config-schema.js";
import { compileExpoBinding } from "./compile-binding.js";
import { ExpoMcpServerCatalog } from "./mcp-catalog.js";
import { ExpoTargetConfigSchema } from "./target-config-schema.js";
import { ExpoTargetSecretSchema } from "./target-secret-schema.js";

export type ExpoMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof ExpoTargetConfigSchema,
  typeof ExpoTargetSecretSchema,
  typeof ExpoBindingConfigSchema,
  ExpoConnectionConfig
>;

export const ExpoMcpBaseDefinition: ExpoMcpBaseIntegrationDefinition = {
  familyId: "expo",
  variantId: "expo-mcp",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Expo",
  description:
    "Enable Expo hosted MCP access for Expo docs, EAS builds, workflows, and TestFlight data.",
  logoKey: "expo",
  targetConfigSchema: ExpoTargetConfigSchema,
  targetSecretSchema: ExpoTargetSecretSchema,
  bindingConfigSchema: ExpoBindingConfigSchema,
  bindingConfigForm: resolveExpoBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Expo MCP OAuth",
      kind: "redirect",
      configSchema: ExpoConnectionConfigSchema,
      ui: {
        create: {
          submitLabel: "Connect Expo",
          helperText: "Authorize Expo hosted MCP access.",
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  mcp: (input) =>
    resolveRemoteMcpServers({
      catalog: ExpoMcpServerCatalog,
      selectedIds: input.binding.config.mcpServers,
    }),
  compileBinding: compileExpoBinding,
};
