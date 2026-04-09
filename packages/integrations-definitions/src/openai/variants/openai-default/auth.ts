import { createOAuth2AuthorizationCodeCredentialSlotKeys } from "@mistle/integrations-core";
import { z } from "zod";

import { OpenAiConnectionMethodIds } from "./model-capabilities.js";

export const OpenAiApiKeyCredentialSecretTypes: {
  API_KEY: "api_key";
  ACCESS_TOKEN: "oauth2_access_token";
} = {
  API_KEY: "api_key",
  ACCESS_TOKEN: "oauth2_access_token",
};

export const OpenAiCredentialSlotKeys: {
  API_KEY: "openai.openai-default.api-key.api-key";
} = {
  API_KEY: "openai.openai-default.api-key.api-key",
};

export const OpenAiApiKeyConnectionConfigSchema = z
  .object({
    connection_method: z.literal(OpenAiConnectionMethodIds.API_KEY),
  })
  .strict();

export const OpenAiChatGptDeviceCodeConnectionConfigSchema = z
  .object({
    connection_method: z.literal(OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE),
    auth_mode: z.literal("chatgpt"),
    chatgpt_account_id: z.string().min(1),
    chatgpt_plan_type: z.string().min(1).optional(),
  })
  .strict();

export const OpenAiConnectionConfigSchema = z.discriminatedUnion("connection_method", [
  OpenAiApiKeyConnectionConfigSchema,
  OpenAiChatGptDeviceCodeConnectionConfigSchema,
]);

export type OpenAiConnectionConfig = z.output<typeof OpenAiConnectionConfigSchema>;
export type OpenAiChatGptDeviceCodeConnectionConfig = z.output<
  typeof OpenAiChatGptDeviceCodeConnectionConfigSchema
>;

export function resolveOpenAiCredentialSecretType(
  input: unknown,
): "api_key" | "oauth2_access_token" {
  const parsedConnectionConfig = OpenAiConnectionConfigSchema.parse(input);
  const methodId = parsedConnectionConfig.connection_method;

  if (methodId === OpenAiConnectionMethodIds.API_KEY) {
    return OpenAiApiKeyCredentialSecretTypes.API_KEY;
  }

  if (methodId === OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE) {
    return OpenAiApiKeyCredentialSecretTypes.ACCESS_TOKEN;
  }

  throw new Error(`Unsupported OpenAI connection method '${String(methodId)}'.`);
}

export function resolveOpenAiCredentialSlotKey(input: {
  familyId: string;
  variantId: string;
  connectionConfig: unknown;
}): string {
  const parsedConnectionConfig = OpenAiConnectionConfigSchema.parse(input.connectionConfig);
  const methodId = parsedConnectionConfig.connection_method;

  if (methodId === OpenAiConnectionMethodIds.API_KEY) {
    return OpenAiCredentialSlotKeys.API_KEY;
  }

  if (methodId === OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE) {
    return createOAuth2AuthorizationCodeCredentialSlotKeys({
      familyId: input.familyId,
      variantId: input.variantId,
    }).accessToken;
  }

  throw new Error(`Unsupported OpenAI connection method '${String(methodId)}'.`);
}

export function assertOpenAiChatGptDeviceCodeConnectionConfig(
  input: unknown,
): OpenAiChatGptDeviceCodeConnectionConfig {
  const parsedConnectionConfig = OpenAiConnectionConfigSchema.parse(input);
  if (parsedConnectionConfig.connection_method !== OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE) {
    throw new Error(
      `Expected OpenAI ChatGPT device-code connection config, received '${parsedConnectionConfig.connection_method}'.`,
    );
  }

  return parsedConnectionConfig;
}
