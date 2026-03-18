import {
  IntegrationConnectionMethodIds,
  IntegrationConnectionMethodKinds,
  IntegrationKinds,
  IntegrationMcpConfigFormats,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import { type OpenAiConnectionConfig, OpenAiConnectionConfigSchema } from "./auth.js";
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
  OpenAiConnectionConfig
>;

const OpenAiApiKeyTargetSecretSchema = z.object({}).strict();

export const OpenAiApiKeyDefinition: OpenAiApiKeyIntegrationDefinition = {
  familyId: "openai",
  variantId: "openai-default",
  kind: IntegrationKinds.AGENT,
  displayName: "OpenAI",
  description: "Enable OpenAI model access with API key authentication.",
  logoKey: "openai",
  targetConfigSchema: OpenAiApiKeyTargetConfigSchema,
  targetSecretSchema: OpenAiApiKeyTargetSecretSchema,
  bindingConfigSchema: OpenAiApiKeyBindingConfigSchema,
  bindingConfigForm: resolveOpenAiBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: IntegrationConnectionMethodKinds.API_KEY,
      configSchema: OpenAiConnectionConfigSchema,
      configForm: OpenAiConnectionConfigForm,
    },
  ],
  validateBindingWriteContext: validateOpenAiBindingWriteContext,
  mcpConfig: {
    clientId: "codex-cli",
    fileId: "codex_config",
    format: IntegrationMcpConfigFormats.TOML,
    path: ["mcp_servers"],
  },
  compileBinding: compileOpenAiApiKeyBinding,
};
