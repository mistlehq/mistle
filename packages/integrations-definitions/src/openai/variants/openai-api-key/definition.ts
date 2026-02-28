import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";

import { OpenAiApiKeySupportedAuthSchemes } from "./auth.js";
import {
  OpenAiApiKeyBindingConfigSchema,
  type OpenAiApiKeyBindingConfig,
} from "./binding-config-schema.js";
import { compileOpenAiApiKeyBinding } from "./compile-binding.js";
import {
  OpenAiApiKeyTargetConfigSchema,
  type OpenAiApiKeyTargetConfig,
} from "./target-config-schema.js";
import { OpenAiApiKeyTriggerEventTypes } from "./webhook.js";

type OpenAiApiKeyIntegrationDefinition = IntegrationDefinition<
  { parse: (input: unknown) => OpenAiApiKeyTargetConfig },
  { parse: (input: unknown) => OpenAiApiKeyBindingConfig }
>;

export const OpenAiApiKeyDefinition: OpenAiApiKeyIntegrationDefinition = {
  familyId: "openai",
  variantId: "openai-api-key",
  kind: IntegrationKinds.AGENT,
  displayName: "OpenAI",
  description: "OpenAI API key based integration for Codex runtime sessions.",
  logoKey: "openai",
  targetConfigSchema: OpenAiApiKeyTargetConfigSchema,
  bindingConfigSchema: OpenAiApiKeyBindingConfigSchema,
  supportedAuthSchemes: OpenAiApiKeySupportedAuthSchemes,
  triggerEventTypes: OpenAiApiKeyTriggerEventTypes,
  compileBinding: compileOpenAiApiKeyBinding,
};
