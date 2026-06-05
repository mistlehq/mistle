import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type CompileBindingInput,
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
  type OpenAiApiKeyBindingConfig,
  OpenAiApiKeyBindingConfigSchema,
} from "./binding-config-schema.js";
import {
  OpenAiDeviceAuthorizationCapability,
  OpenAiDeviceAuthorizationOAuth2Capability,
} from "./device-authorization.js";
import { OpenAiConnectionMethodIds } from "./model-capabilities.js";
import {
  OpenAiApiKeyTargetConfigSchema,
  resolveOpenAiRouteBaseUrlForConnectionMethod,
  type OpenAiApiKeyTargetConfig,
} from "./target-config-schema.js";
import { validateOpenAiBindingWriteContext } from "./validate-binding-write-context.js";

type OpenAiApiKeyIntegrationDefinition = IntegrationDefinition<
  typeof OpenAiApiKeyTargetConfigSchema,
  typeof OpenAiApiKeyTargetSecretSchema,
  typeof OpenAiApiKeyBindingConfigSchema,
  OpenAiConnectionConfig
>;

const OpenAiApiKeyTargetSecretSchema = z.object({}).strict();
const OpenAiAllowedRuntimeIds = ["codex", "opencode", "pi"] as const;

type OpenAiProviderRouteConfig = {
  apiBaseUrl: string;
  authScheme: "bearer";
  credentialResolver: {
    connectionId: string;
    secretType: "api_key" | "oauth2_access_token";
    slotKey?: string;
  };
  additionalHeaders?: Record<string, string>;
  allowedMethods: ReadonlyArray<"GET" | "POST">;
  allowedPathPrefixes: ReadonlyArray<string>;
};

function resolveOpenAiProviderRouteConfig(
  input: CompileBindingInput<
    OpenAiApiKeyTargetConfig,
    OpenAiApiKeyBindingConfig,
    z.output<typeof OpenAiApiKeyTargetSecretSchema>
  >,
): OpenAiProviderRouteConfig {
  const connectionConfig = OpenAiConnectionConfigSchema.parse(input.connection.config);

  return {
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
    ...(connectionConfig.connection_method === OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE &&
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
  };
}

function compileOpenAiBinding(
  input: CompileBindingInput<
    OpenAiApiKeyTargetConfig,
    OpenAiApiKeyBindingConfig,
    z.output<typeof OpenAiApiKeyTargetSecretSchema>
  >,
): CompileBindingResult {
  const routeConfig = resolveOpenAiProviderRouteConfig(input);
  const routeHost = new URL(routeConfig.apiBaseUrl).host;

  return {
    egressRoutes: [
      {
        match: {
          hosts: [routeHost],
          pathPrefixes: [...routeConfig.allowedPathPrefixes],
          methods: [...routeConfig.allowedMethods],
        },
        upstream: {
          baseUrl: routeConfig.apiBaseUrl,
        },
        authInjection: {
          type: routeConfig.authScheme,
          target: "authorization",
        },
        ...(routeConfig.additionalHeaders === undefined
          ? {}
          : { additionalHeaders: routeConfig.additionalHeaders }),
        credentialResolver: {
          kind: "integration_connection",
          connectionId: routeConfig.credentialResolver.connectionId,
          secretType: routeConfig.credentialResolver.secretType,
          ...(routeConfig.credentialResolver.slotKey === undefined
            ? {}
            : { slotKey: routeConfig.credentialResolver.slotKey }),
        },
      },
    ],
    artifacts: [],
    runtimeClients: [],
  };
}

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
        },
        pending: {
          title: "Approve via ChatGPT",
          description: "Open the link below and enter the code to approve access.",
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  validateBindingWriteContext: validateOpenAiBindingWriteContext,
  deviceAuthorization: OpenAiDeviceAuthorizationCapability,
  oauth2AuthorizationCode: OpenAiDeviceAuthorizationOAuth2Capability,
  compileBinding: compileOpenAiBinding,
};
