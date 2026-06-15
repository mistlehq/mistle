import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type FireworksConnectionConfig,
  FireworksConnectionConfigSchema,
  FireworksCredentialSlotKeys,
} from "./auth.js";
import {
  FireworksConnectionConfigForm,
  resolveFireworksBindingConfigForm,
} from "./binding-config-form.js";
import { FireworksBindingConfigSchema } from "./binding-config-schema.js";
import { compileFireworksBinding } from "./compile-binding.js";
import { FireworksTargetConfigSchema } from "./target-config-schema.js";

type FireworksIntegrationDefinition = IntegrationDefinition<
  typeof FireworksTargetConfigSchema,
  typeof FireworksTargetSecretSchema,
  typeof FireworksBindingConfigSchema,
  FireworksConnectionConfig
>;

const FireworksTargetSecretSchema = z.object({}).strict();
const FireworksAllowedRuntimeIds = ["opencode", "pi"] as const;

export const FireworksDefinition: FireworksIntegrationDefinition = {
  familyId: "fireworks",
  variantId: "fireworks-default",
  kind: IntegrationKinds.AGENT,
  displayName: "Fireworks AI",
  description: "Enable Fireworks AI model access with API key authentication.",
  logoKey: "fireworks",
  targetConfigSchema: FireworksTargetConfigSchema,
  targetSecretSchema: FireworksTargetSecretSchema,
  bindingConfigSchema: FireworksBindingConfigSchema,
  bindingConfigForm: resolveFireworksBindingConfigForm,
  allowedRuntimeIds: FireworksAllowedRuntimeIds,
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
          slotKey: FireworksCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: FireworksConnectionConfigSchema,
      configForm: FireworksConnectionConfigForm,
    },
  ],
  compileBinding: compileFireworksBinding,
};
