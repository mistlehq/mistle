import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";
import { z } from "zod";

import { OpenAiApiKeySupportedAuthSchemes, OpenAiConnectionConfigSchema } from "./auth.js";
import {
  OpenAiConnectionConfigForm,
  resolveOpenAiBindingConfigForm,
} from "./binding-config-form.js";
import { OpenAiApiKeyBindingConfigSchema } from "./binding-config-schema.js";
import { compileOpenAiApiKeyBinding } from "./compile-binding.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";
import { validateOpenAiBindingWriteContext } from "./validate-binding-write-context.js";

type OpenAiApiKeyIntegrationDefinition = IntegrationDefinition<
  typeof OpenAiApiKeyTargetConfigSchema,
  typeof OpenAiApiKeyTargetSecretSchema,
  typeof OpenAiApiKeyBindingConfigSchema,
  typeof OpenAiConnectionConfigSchema
>;

const OpenAiApiKeyTargetSecretSchema = z.object({}).strict();

export const OpenAiApiKeyDefinition: OpenAiApiKeyIntegrationDefinition = {
  familyId: "openai",
  variantId: "openai-default",
  kind: IntegrationKinds.AGENT,
  displayName: "OpenAI",
  description: "Enable OpenAI model access with API key or ChatGPT subscription authentication.",
  logoKey: "openai",
  targetConfigSchema: OpenAiApiKeyTargetConfigSchema,
  targetSecretSchema: OpenAiApiKeyTargetSecretSchema,
  bindingConfigSchema: OpenAiApiKeyBindingConfigSchema,
  bindingConfigForm: resolveOpenAiBindingConfigForm,
  connectionConfigSchema: OpenAiConnectionConfigSchema,
  connectionConfigForm: OpenAiConnectionConfigForm,
  supportedAuthSchemes: OpenAiApiKeySupportedAuthSchemes,
  validateBindingWriteContext: validateOpenAiBindingWriteContext,
  compileBinding: compileOpenAiApiKeyBinding,
};
