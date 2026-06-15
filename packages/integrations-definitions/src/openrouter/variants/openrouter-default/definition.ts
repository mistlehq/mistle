import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type OpenRouterConnectionConfig,
  OpenRouterConnectionConfigSchema,
  OpenRouterCredentialSlotKeys,
} from "./auth.js";
import {
  OpenRouterConnectionConfigForm,
  resolveOpenRouterBindingConfigForm,
} from "./binding-config-form.js";
import { OpenRouterBindingConfigSchema } from "./binding-config-schema.js";
import { compileOpenRouterBinding } from "./compile-binding.js";
import { OpenRouterTargetConfigSchema } from "./target-config-schema.js";

type OpenRouterIntegrationDefinition = IntegrationDefinition<
  typeof OpenRouterTargetConfigSchema,
  typeof OpenRouterTargetSecretSchema,
  typeof OpenRouterBindingConfigSchema,
  OpenRouterConnectionConfig
>;

const OpenRouterTargetSecretSchema = z.object({}).strict();
const OpenRouterAllowedRuntimeIds = ["opencode", "pi"] as const;

export const OpenRouterDefinition: OpenRouterIntegrationDefinition = {
  familyId: "openrouter",
  variantId: "openrouter-default",
  kind: IntegrationKinds.AGENT,
  displayName: "OpenRouter",
  description: "Enable OpenRouter model access with API key authentication.",
  logoKey: "openrouter",
  targetConfigSchema: OpenRouterTargetConfigSchema,
  targetSecretSchema: OpenRouterTargetSecretSchema,
  bindingConfigSchema: OpenRouterBindingConfigSchema,
  bindingConfigForm: resolveOpenRouterBindingConfigForm,
  allowedRuntimeIds: OpenRouterAllowedRuntimeIds,
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
          slotKey: OpenRouterCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: OpenRouterConnectionConfigSchema,
      configForm: OpenRouterConnectionConfigForm,
    },
  ],
  compileBinding: compileOpenRouterBinding,
};
