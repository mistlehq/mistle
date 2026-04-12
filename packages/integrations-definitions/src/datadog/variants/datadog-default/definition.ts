import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type DatadogConnectionConfig,
  DatadogConnectionConfigSchema,
  DatadogCredentialSecretTypes,
  DatadogCredentialSlotKeys,
} from "./auth.js";
import { resolveDatadogBindingConfigForm } from "./binding-config-form.js";
import { DatadogBindingConfigSchema } from "./binding-config-schema.js";
import { compileDatadogBinding } from "./compile-binding.js";
import { DatadogConnectionConfigForm } from "./connection-config-form.js";
import { resolveDatadogMcpUrl, DatadogTargetConfigSchema } from "./target-config-schema.js";
import { DatadogToolIds } from "./tool-ids.js";

type DatadogIntegrationDefinition = IntegrationDefinition<
  typeof DatadogTargetConfigSchema,
  typeof DatadogTargetSecretSchema,
  typeof DatadogBindingConfigSchema,
  DatadogConnectionConfig
>;

const DatadogTargetSecretSchema = z.object({}).strict();

export const DatadogDefinition: DatadogIntegrationDefinition = {
  familyId: "datadog",
  variantId: "datadog-default",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Datadog",
  description: "Enable Datadog hosted MCP access for observability search and tooling.",
  logoKey: "datadog",
  targetConfigSchema: DatadogTargetConfigSchema,
  targetSecretSchema: DatadogTargetSecretSchema,
  bindingConfigSchema: DatadogBindingConfigSchema,
  bindingConfigForm: resolveDatadogBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key + application key",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          placeholder: "Enter API key",
          inputType: "password",
          secretType: DatadogCredentialSecretTypes.API_KEY,
          slotKey: DatadogCredentialSlotKeys.API_KEY,
        },
        {
          name: "applicationKey",
          label: "Application key",
          placeholder: "Enter application key",
          inputType: "password",
          secretType: DatadogCredentialSecretTypes.API_KEY,
          slotKey: DatadogCredentialSlotKeys.APPLICATION_KEY,
        },
      ],
      configSchema: DatadogConnectionConfigSchema,
      configForm: DatadogConnectionConfigForm,
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(DatadogToolIds.DATADOG_MCP)
      ? [
          {
            serverId: DatadogToolIds.DATADOG_MCP,
            serverName: "datadog",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: resolveDatadogMcpUrl(),
            description: "Datadog MCP",
          },
        ]
      : [],
  compileBinding: compileDatadogBinding,
};
