import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type CompileBindingResult,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  resolveOpenAiCredentialSecretType,
  type OpenAiConnectionConfig,
  OpenAiConnectionConfigSchema,
  OpenAiCredentialSlotKeys,
} from "./auth.js";
import {
  OpenAiConnectionConfigForm,
  resolveOpenAiBindingConfigForm,
} from "./binding-config-form.js";
import {
  OpenAiAllowedRuntimeIds,
  OpenAiApiKeyBindingConfigSchema,
} from "./binding-config-schema.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";
import { validateOpenAiBindingWriteContext } from "./validate-binding-write-context.js";

type OpenAiApiKeyIntegrationDefinition = IntegrationDefinition<
  typeof OpenAiApiKeyTargetConfigSchema,
  typeof OpenAiApiKeyTargetSecretSchema,
  typeof OpenAiApiKeyBindingConfigSchema,
  OpenAiConnectionConfig
>;

const OpenAiApiKeyTargetSecretSchema = z.object({}).strict();

const EmptyCompileBindingResult: CompileBindingResult = {
  egressRoutes: [],
  artifacts: [],
  runtimeClients: [],
};

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
  allowedRuntimeIds: OpenAiAllowedRuntimeIds,
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
          slotKey: OpenAiCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: OpenAiConnectionConfigSchema,
      configForm: OpenAiConnectionConfigForm,
    },
  ],
  validateBindingWriteContext: validateOpenAiBindingWriteContext,
  capabilities: {
    resolveCapabilities: (input) => {
      return {
        agentProviderAccess: {
          providerFamilyId: input.target.familyId,
          providerVariantId: input.target.variantId,
          apiBaseUrl: input.target.config.apiBaseUrl,
          authScheme: "bearer",
          credentialResolver: {
            connectionId: input.connection.id,
            secretType: resolveOpenAiCredentialSecretType(input.connection.config),
            slotKey: OpenAiCredentialSlotKeys.API_KEY,
          },
          allowedMethods: ["GET", "POST"],
          allowedPathPrefixes: ["/"],
          defaultModel: input.binding.config.model.defaultModel,
          allowedModels: [...input.target.config.bindingCapabilities.models],
          providerMetadata: {
            reasoningEffort: input.binding.config.model.options.reasoningEffort,
            ...(input.binding.config.model.options.additionalInstructions === undefined
              ? {}
              : {
                  additionalInstructions: input.binding.config.model.options.additionalInstructions,
                }),
          },
        },
      };
    },
  },
  compileBinding: () => EmptyCompileBindingResult,
};
