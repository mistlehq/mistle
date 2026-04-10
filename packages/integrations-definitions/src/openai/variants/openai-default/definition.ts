import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type CompileBindingResult,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  OpenAiApiKeyConnectionConfigSchema,
  OpenAiConnectionConfigSchema,
  OpenAiCredentialSlotKeys,
  resolveOpenAiCredentialSlotKey,
  resolveOpenAiCredentialSecretType,
  type OpenAiConnectionConfig,
} from "./auth.js";
import {
  OpenAiConnectionConfigForm,
  resolveOpenAiBindingConfigForm,
} from "./binding-config-form.js";
import {
  OpenAiAllowedRuntimeIds,
  OpenAiApiKeyBindingConfigSchema,
} from "./binding-config-schema.js";
import {
  OpenAiDeviceAuthorizationCapability,
  OpenAiDeviceAuthorizationOAuth2Capability,
} from "./device-authorization.js";
import {
  OpenAiConnectionMethodIds,
  resolveOpenAiCapabilitySetForConnectionMethod,
} from "./model-capabilities.js";
import {
  OpenAiApiKeyTargetConfigSchema,
  resolveOpenAiChatGptBaseUrlForConnectionMethod,
  resolveOpenAiResponsesApiBaseUrlForConnectionMethod,
  resolveOpenAiRouteBaseUrlForConnectionMethod,
} from "./target-config-schema.js";
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
  description: "Enable OpenAI model access with API key or ChatGPT subscription authentication.",
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
      configSchema: OpenAiApiKeyConnectionConfigSchema,
      configForm: OpenAiConnectionConfigForm,
    },
    {
      id: OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE,
      label: "ChatGPT subscription",
      kind: "device-authorization",
      ui: {
        create: {
          submitLabel: "Connect",
          helperText: "Connect with your ChatGPT subscription using a device code.",
        },
        pending: {
          title: "Approve In ChatGPT",
          description:
            "Open the verification link, enter the device code, and approve access in ChatGPT.",
        },
      },
    },
  ],
  validateBindingWriteContext: validateOpenAiBindingWriteContext,
  deviceAuthorization: OpenAiDeviceAuthorizationCapability,
  oauth2AuthorizationCode: OpenAiDeviceAuthorizationOAuth2Capability,
  capabilities: {
    resolveCapabilities: (input) => {
      const connectionConfig = OpenAiConnectionConfigSchema.parse(input.connection.config);
      const capabilitySet = resolveOpenAiCapabilitySetForConnectionMethod({
        bindingCapabilitiesByConnectionMethod:
          input.target.config.bindingCapabilitiesByConnectionMethod,
        connectionMethod: connectionConfig.connection_method,
      });

      return {
        agentProviderAccess: {
          providerFamilyId: input.target.familyId,
          providerVariantId: input.target.variantId,
          apiBaseUrl: resolveOpenAiRouteBaseUrlForConnectionMethod({
            targetConfig: input.target.config,
            connectionMethod: connectionConfig.connection_method,
          }),
          authScheme: "bearer",
          credentialResolver: {
            connectionId: input.connection.id,
            secretType: resolveOpenAiCredentialSecretType(input.connection.config),
            slotKey: resolveOpenAiCredentialSlotKey({
              familyId: input.target.familyId,
              variantId: input.target.variantId,
              connectionConfig: input.connection.config,
            }),
          },
          ...(connectionConfig.connection_method ===
            OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE &&
          connectionConfig.chatgpt_account_id !== undefined
            ? {
                additionalHeaders: {
                  "ChatGPT-Account-ID": connectionConfig.chatgpt_account_id,
                },
              }
            : {}),
          allowedMethods: ["GET", "POST"],
          allowedPathPrefixes:
            connectionConfig.connection_method === OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE
              ? ["/"]
              : ["/"],
          defaultModel: input.binding.config.model.defaultModel,
          allowedModels: [...capabilitySet.models],
          providerMetadata: {
            reasoningEffort: input.binding.config.model.options.reasoningEffort,
            responsesApiBaseUrl: resolveOpenAiResponsesApiBaseUrlForConnectionMethod({
              targetConfig: input.target.config,
              connectionMethod: connectionConfig.connection_method,
            }),
            ...(resolveOpenAiChatGptBaseUrlForConnectionMethod({
              connectionMethod: connectionConfig.connection_method,
            }) === undefined
              ? {}
              : {
                  chatgptBaseUrl: resolveOpenAiChatGptBaseUrlForConnectionMethod({
                    connectionMethod: connectionConfig.connection_method,
                  }),
                }),
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
