import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";
import { z } from "zod";

import { IntegrationBindingEditorUiProjectionSchema } from "../../../ui/binding-editor-ui-contract.js";
import { OpenAiApiKeySupportedAuthSchemes, OpenAiConnectionConfigSchema } from "./auth.js";
import {
  OpenAiApiKeyBindingConfigSchema,
  type OpenAiApiKeyBindingConfig,
} from "./binding-config-schema.js";
import { compileOpenAiApiKeyBinding } from "./compile-binding.js";
import { projectOpenAiBindingEditorUi } from "./project-binding-editor-ui.js";
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
  projectBindingEditorUi: ({ targetConfig }) =>
    projectOpenAiBindingEditorUi({
      targetConfig,
    }),
  bindingEditorUiProjectionSchema: IntegrationBindingEditorUiProjectionSchema,
  compileBinding: compileOpenAiApiKeyBinding,
};
