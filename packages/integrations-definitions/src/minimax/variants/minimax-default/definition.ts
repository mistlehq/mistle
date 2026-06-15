import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type MiniMaxConnectionConfig,
  MiniMaxConnectionConfigSchema,
  MiniMaxCredentialSlotKeys,
} from "./auth.js";
import {
  MiniMaxConnectionConfigForm,
  resolveMiniMaxBindingConfigForm,
} from "./binding-config-form.js";
import { MiniMaxBindingConfigSchema } from "./binding-config-schema.js";
import { compileMiniMaxBinding } from "./compile-binding.js";
import { MiniMaxTargetConfigSchema } from "./target-config-schema.js";

type MiniMaxIntegrationDefinition = IntegrationDefinition<
  typeof MiniMaxTargetConfigSchema,
  typeof MiniMaxTargetSecretSchema,
  typeof MiniMaxBindingConfigSchema,
  MiniMaxConnectionConfig
>;

const MiniMaxTargetSecretSchema = z.object({}).strict();
const MiniMaxAllowedRuntimeIds = ["opencode", "pi"] as const;

export const MiniMaxDefinition: MiniMaxIntegrationDefinition = {
  familyId: "minimax",
  variantId: "minimax-default",
  kind: IntegrationKinds.AGENT,
  displayName: "MiniMax",
  description: "Enable MiniMax model access with API key authentication.",
  logoKey: "minimax",
  targetConfigSchema: MiniMaxTargetConfigSchema,
  targetSecretSchema: MiniMaxTargetSecretSchema,
  bindingConfigSchema: MiniMaxBindingConfigSchema,
  bindingConfigForm: resolveMiniMaxBindingConfigForm,
  allowedRuntimeIds: MiniMaxAllowedRuntimeIds,
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
          slotKey: MiniMaxCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: MiniMaxConnectionConfigSchema,
      configForm: MiniMaxConnectionConfigForm,
    },
  ],
  compileBinding: compileMiniMaxBinding,
};
