import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type MetaAdsConnectionConfig,
  MetaAdsConnectionConfigSchema,
  MetaAdsCredentialSecretTypes,
  MetaAdsCredentialSlotKeys,
  MetaAdsDefaultVariantId,
  MetaAdsFamilyId,
} from "./auth.js";
import { resolveMetaAdsBindingConfigForm } from "./binding-config-form.js";
import { MetaAdsBindingConfigSchema } from "./binding-config-schema.js";
import { compileMetaAdsBinding, MetaAdsMcpUrl } from "./compile-binding.js";
import { MetaAdsConnectionConfigForm } from "./connection-config-form.js";
import { MetaAdsTargetConfigSchema } from "./target-config-schema.js";
import { MetaAdsTargetSecretSchema } from "./target-secret-schema.js";
import { MetaAdsToolIds } from "./tool-ids.js";

export type MetaAdsBaseIntegrationDefinition = IntegrationDefinition<
  typeof MetaAdsTargetConfigSchema,
  typeof MetaAdsTargetSecretSchema,
  typeof MetaAdsBindingConfigSchema,
  MetaAdsConnectionConfig
>;

export const MetaAdsBaseDefinition: MetaAdsBaseIntegrationDefinition = {
  familyId: MetaAdsFamilyId,
  variantId: MetaAdsDefaultVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Meta Ads",
  description: "Enable Meta Marketing API access in sandbox.",
  logoKey: "metaads",
  targetConfigSchema: MetaAdsTargetConfigSchema,
  targetSecretSchema: MetaAdsTargetSecretSchema,
  bindingConfigSchema: MetaAdsBindingConfigSchema,
  bindingConfigForm: resolveMetaAdsBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "Access token",
      kind: "form",
      secretFields: [
        {
          name: "accessToken",
          label: "Access token",
          placeholder: "Enter Meta access token",
          inputType: "password",
          secretType: MetaAdsCredentialSecretTypes.API_KEY,
          slotKey: MetaAdsCredentialSlotKeys.ACCESS_TOKEN,
        },
      ],
      configSchema: MetaAdsConnectionConfigSchema,
      configForm: MetaAdsConnectionConfigForm,
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(MetaAdsToolIds.METAADS_MCP)
      ? [
          {
            serverId: MetaAdsToolIds.METAADS_MCP,
            serverName: "metaads",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: MetaAdsMcpUrl,
            description: "Meta Ads MCP",
          },
        ]
      : [],
  compileBinding: compileMetaAdsBinding,
};
