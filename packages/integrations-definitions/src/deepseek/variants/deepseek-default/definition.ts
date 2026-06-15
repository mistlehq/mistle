import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type DeepSeekConnectionConfig,
  DeepSeekConnectionConfigSchema,
  DeepSeekCredentialSlotKeys,
} from "./auth.js";
import {
  DeepSeekConnectionConfigForm,
  resolveDeepSeekBindingConfigForm,
} from "./binding-config-form.js";
import { DeepSeekBindingConfigSchema } from "./binding-config-schema.js";
import { compileDeepSeekBinding } from "./compile-binding.js";
import { DeepSeekTargetConfigSchema } from "./target-config-schema.js";

type DeepSeekIntegrationDefinition = IntegrationDefinition<
  typeof DeepSeekTargetConfigSchema,
  typeof DeepSeekTargetSecretSchema,
  typeof DeepSeekBindingConfigSchema,
  DeepSeekConnectionConfig
>;

const DeepSeekTargetSecretSchema = z.object({}).strict();
const DeepSeekAllowedRuntimeIds = ["pi"] as const;

export const DeepSeekDefinition: DeepSeekIntegrationDefinition = {
  familyId: "deepseek",
  variantId: "deepseek-default",
  kind: IntegrationKinds.AGENT,
  displayName: "DeepSeek",
  description: "Enable DeepSeek model access with API key authentication.",
  logoKey: "deepseek",
  targetConfigSchema: DeepSeekTargetConfigSchema,
  targetSecretSchema: DeepSeekTargetSecretSchema,
  bindingConfigSchema: DeepSeekBindingConfigSchema,
  bindingConfigForm: resolveDeepSeekBindingConfigForm,
  allowedRuntimeIds: DeepSeekAllowedRuntimeIds,
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
          slotKey: DeepSeekCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: DeepSeekConnectionConfigSchema,
      configForm: DeepSeekConnectionConfigForm,
    },
  ],
  compileBinding: compileDeepSeekBinding,
};
