import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type ZaiConnectionConfig,
  ZaiConnectionConfigSchema,
  ZaiCredentialSlotKeys,
} from "./auth.js";
import { ZaiConnectionConfigForm, resolveZaiBindingConfigForm } from "./binding-config-form.js";
import { ZaiBindingConfigSchema } from "./binding-config-schema.js";
import { compileZaiBinding } from "./compile-binding.js";
import { ZaiTargetConfigSchema } from "./target-config-schema.js";

type ZaiIntegrationDefinition = IntegrationDefinition<
  typeof ZaiTargetConfigSchema,
  typeof ZaiTargetSecretSchema,
  typeof ZaiBindingConfigSchema,
  ZaiConnectionConfig
>;

const ZaiTargetSecretSchema = z.object({}).strict();
const ZaiAllowedRuntimeIds = ["opencode", "pi"] as const;

export const ZaiDefinition: ZaiIntegrationDefinition = {
  familyId: "zai",
  variantId: "zai-coding-plan",
  kind: IntegrationKinds.AGENT,
  displayName: "Z.ai Coding Plan",
  description: "Enable Z.ai Coding Plan model access with API key authentication.",
  logoKey: "zai",
  targetConfigSchema: ZaiTargetConfigSchema,
  targetSecretSchema: ZaiTargetSecretSchema,
  bindingConfigSchema: ZaiBindingConfigSchema,
  bindingConfigForm: resolveZaiBindingConfigForm,
  allowedRuntimeIds: ZaiAllowedRuntimeIds,
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
          slotKey: ZaiCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: ZaiConnectionConfigSchema,
      configForm: ZaiConnectionConfigForm,
    },
  ],
  compileBinding: compileZaiBinding,
};
