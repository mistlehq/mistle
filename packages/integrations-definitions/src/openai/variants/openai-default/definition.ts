import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";
import { z } from "zod";

import { OpenAiApiKeySupportedAuthSchemes, OpenAiConnectionConfigSchema } from "./auth.js";
import {
  OpenAiApiKeyBindingConfigSchema,
  type OpenAiApiKeyBindingConfig,
  OpenAiReasoningEfforts,
  OpenAiRuntimes,
} from "./binding-config-schema.js";
import { compileOpenAiApiKeyBinding } from "./compile-binding.js";
import { projectOpenAiTargetUi } from "./project-target-ui.js";
import {
  OpenAiApiKeyTargetConfigSchema,
  type OpenAiApiKeyTargetConfig,
} from "./target-config-schema.js";
import { OpenAiTargetUiProjectionSchema } from "./ui-contract.js";
import { validateOpenAiBindingWriteContext } from "./validate-binding-write-context.js";

type OpenAiApiKeyIntegrationDefinition = IntegrationDefinition<
  { parse: (input: unknown) => OpenAiApiKeyTargetConfig },
  { parse: (input: unknown) => Record<string, never> },
  { parse: (input: unknown) => OpenAiApiKeyBindingConfig }
>;

const OpenAiUserCodexConfigSchema = z.string().min(1);
const OpenAiUserModelSchema = z.string().min(1);
const OpenAiUserReasoningEffortSchema = z.enum([
  OpenAiReasoningEfforts.LOW,
  OpenAiReasoningEfforts.MEDIUM,
  OpenAiReasoningEfforts.HIGH,
  OpenAiReasoningEfforts.XHIGH,
]);
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
  connectionConfigSchema: OpenAiConnectionConfigSchema,
  supportedAuthSchemes: OpenAiApiKeySupportedAuthSchemes,
  validateBindingWriteContext: validateOpenAiBindingWriteContext,
  projectTargetUi: ({ targetConfig }) =>
    projectOpenAiTargetUi({
      targetConfig,
    }),
  targetUiProjectionSchema: OpenAiTargetUiProjectionSchema,
  userConfigSlots: [
    {
      kind: "file",
      key: "codex_config",
      label: "Codex Config",
      description: "Custom TOML content merged into the generated Codex config.",
      format: "toml",
      valueSchema: OpenAiUserCodexConfigSchema,
      applyTo: {
        clientId: OpenAiRuntimes.CODEX_CLI,
        fileId: "codex_config",
      },
      mergePolicy: {
        strategy: "structured-merge",
        preservePaths: ["model", "model_reasoning_effort"],
      },
    },
    {
      kind: "env",
      key: "openai_model",
      label: "OpenAI Model",
      description: "Overrides OPENAI_MODEL for Codex runtime startup.",
      valueSchema: OpenAiUserModelSchema,
      applyTo: {
        clientId: OpenAiRuntimes.CODEX_CLI,
        envKey: "OPENAI_MODEL",
      },
      policy: {
        mutable: "user-overrides",
      },
    },
    {
      kind: "env",
      key: "openai_reasoning_effort",
      label: "OpenAI Reasoning Effort",
      description: "Overrides OPENAI_REASONING_EFFORT for Codex runtime startup.",
      valueSchema: OpenAiUserReasoningEffortSchema,
      applyTo: {
        clientId: OpenAiRuntimes.CODEX_CLI,
        envKey: "OPENAI_REASONING_EFFORT",
      },
      policy: {
        mutable: "user-overrides",
      },
    },
  ],
  compileBinding: compileOpenAiApiKeyBinding,
};
