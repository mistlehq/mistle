import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type AnthropicConnectionConfig,
  AnthropicConnectionConfigSchema,
  AnthropicCredentialSlotKeys,
} from "./auth.js";
import {
  AnthropicConnectionConfigForm,
  resolveAnthropicBindingConfigForm,
} from "./binding-config-form.js";
import { AnthropicBindingConfigSchema } from "./binding-config-schema.js";
import { compileAnthropicBinding } from "./compile-binding.js";
import { AnthropicTargetConfigSchema } from "./target-config-schema.js";

type AnthropicIntegrationDefinition = IntegrationDefinition<
  typeof AnthropicTargetConfigSchema,
  typeof AnthropicTargetSecretSchema,
  typeof AnthropicBindingConfigSchema,
  AnthropicConnectionConfig
>;

const AnthropicTargetSecretSchema = z.object({}).strict();
const AnthropicAllowedRuntimeIds = ["opencode", "pi"] as const;

export const AnthropicDefinition: AnthropicIntegrationDefinition = {
  familyId: "anthropic",
  variantId: "anthropic-default",
  kind: IntegrationKinds.AGENT,
  displayName: "Anthropic",
  description: "Enable Anthropic model access with API key authentication.",
  logoKey: "anthropic",
  targetConfigSchema: AnthropicTargetConfigSchema,
  targetSecretSchema: AnthropicTargetSecretSchema,
  bindingConfigSchema: AnthropicBindingConfigSchema,
  bindingConfigForm: resolveAnthropicBindingConfigForm,
  allowedRuntimeIds: AnthropicAllowedRuntimeIds,
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
          slotKey: AnthropicCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: AnthropicConnectionConfigSchema,
      configForm: AnthropicConnectionConfigForm,
    },
  ],
  compileBinding: compileAnthropicBinding,
};
