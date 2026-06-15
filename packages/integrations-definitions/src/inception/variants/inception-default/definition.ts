import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type InceptionConnectionConfig,
  InceptionConnectionConfigSchema,
  InceptionCredentialSlotKeys,
} from "./auth.js";
import {
  InceptionConnectionConfigForm,
  resolveInceptionBindingConfigForm,
} from "./binding-config-form.js";
import { InceptionBindingConfigSchema } from "./binding-config-schema.js";
import { compileInceptionBinding } from "./compile-binding.js";
import { InceptionTargetConfigSchema } from "./target-config-schema.js";

type InceptionIntegrationDefinition = IntegrationDefinition<
  typeof InceptionTargetConfigSchema,
  typeof InceptionTargetSecretSchema,
  typeof InceptionBindingConfigSchema,
  InceptionConnectionConfig
>;

const InceptionTargetSecretSchema = z.object({}).strict();
const InceptionAllowedRuntimeIds = ["opencode", "pi"] as const;

export const InceptionDefinition: InceptionIntegrationDefinition = {
  familyId: "inception",
  variantId: "inception-default",
  kind: IntegrationKinds.AGENT,
  displayName: "Inception Labs",
  description: "Enable Inception Labs model access with API key authentication.",
  logoKey: "inception",
  targetConfigSchema: InceptionTargetConfigSchema,
  targetSecretSchema: InceptionTargetSecretSchema,
  bindingConfigSchema: InceptionBindingConfigSchema,
  bindingConfigForm: resolveInceptionBindingConfigForm,
  allowedRuntimeIds: InceptionAllowedRuntimeIds,
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
          slotKey: InceptionCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: InceptionConnectionConfigSchema,
      configForm: InceptionConnectionConfigForm,
    },
  ],
  compileBinding: compileInceptionBinding,
};
