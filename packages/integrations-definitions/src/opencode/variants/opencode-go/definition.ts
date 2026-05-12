import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type OpenCodeGoConnectionConfig,
  OpenCodeGoConnectionConfigSchema,
  OpenCodeGoCredentialSlotKeys,
} from "./auth.js";
import {
  OpenCodeGoConnectionConfigForm,
  resolveOpenCodeGoBindingConfigForm,
} from "./binding-config-form.js";
import { OpenCodeGoBindingConfigSchema } from "./binding-config-schema.js";
import { compileOpenCodeGoBinding } from "./compile-binding.js";
import { OpenCodeGoTargetConfigSchema } from "./target-config-schema.js";

type OpenCodeGoIntegrationDefinition = IntegrationDefinition<
  typeof OpenCodeGoTargetConfigSchema,
  typeof OpenCodeGoTargetSecretSchema,
  typeof OpenCodeGoBindingConfigSchema,
  OpenCodeGoConnectionConfig
>;

const OpenCodeGoTargetSecretSchema = z.object({}).strict();
const OpenCodeGoAllowedRuntimeIds = ["opencode"] as const;

export const OpenCodeGoDefinition: OpenCodeGoIntegrationDefinition = {
  familyId: "opencode",
  variantId: "opencode-go",
  kind: IntegrationKinds.AGENT,
  displayName: "OpenCode Go",
  description: "Enable OpenCode Go model access with API key authentication.",
  logoKey: "opencode",
  targetConfigSchema: OpenCodeGoTargetConfigSchema,
  targetSecretSchema: OpenCodeGoTargetSecretSchema,
  bindingConfigSchema: OpenCodeGoBindingConfigSchema,
  bindingConfigForm: resolveOpenCodeGoBindingConfigForm,
  allowedRuntimeIds: OpenCodeGoAllowedRuntimeIds,
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
          slotKey: OpenCodeGoCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: OpenCodeGoConnectionConfigSchema,
      configForm: OpenCodeGoConnectionConfigForm,
    },
  ],
  compileBinding: compileOpenCodeGoBinding,
};
