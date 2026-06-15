import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type KimiConnectionConfig,
  KimiConnectionConfigSchema,
  KimiCredentialSlotKeys,
} from "./auth.js";
import { KimiConnectionConfigForm, resolveKimiBindingConfigForm } from "./binding-config-form.js";
import { KimiBindingConfigSchema } from "./binding-config-schema.js";
import { compileKimiBinding } from "./compile-binding.js";
import { KimiTargetConfigSchema } from "./target-config-schema.js";

type KimiIntegrationDefinition = IntegrationDefinition<
  typeof KimiTargetConfigSchema,
  typeof KimiTargetSecretSchema,
  typeof KimiBindingConfigSchema,
  KimiConnectionConfig
>;

const KimiTargetSecretSchema = z.object({}).strict();
const KimiAllowedRuntimeIds = ["opencode", "pi"] as const;

export const KimiDefinition: KimiIntegrationDefinition = {
  familyId: "kimi",
  variantId: "kimi-default",
  kind: IntegrationKinds.AGENT,
  displayName: "Kimi",
  description: "Enable Kimi model access with API key authentication.",
  logoKey: "kimi",
  targetConfigSchema: KimiTargetConfigSchema,
  targetSecretSchema: KimiTargetSecretSchema,
  bindingConfigSchema: KimiBindingConfigSchema,
  bindingConfigForm: resolveKimiBindingConfigForm,
  allowedRuntimeIds: KimiAllowedRuntimeIds,
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
          slotKey: KimiCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: KimiConnectionConfigSchema,
      configForm: KimiConnectionConfigForm,
    },
  ],
  compileBinding: compileKimiBinding,
};
