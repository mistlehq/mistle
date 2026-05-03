import { z } from "zod";

import { OpenAiConnectionMethodIds, isOpenAiConnectionMethodId } from "./model-capabilities.js";

const OpenAiApiBaseUrlSchema = z.url().transform((input) => {
  const parsedUrl = new URL(input);
  const normalizedPathname =
    parsedUrl.pathname.endsWith("/") && parsedUrl.pathname !== "/"
      ? parsedUrl.pathname.slice(0, -1)
      : parsedUrl.pathname;

  parsedUrl.pathname = normalizedPathname;
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return parsedUrl.toString();
});

export const OpenAiChatGptOriginBaseUrl = "https://chatgpt.com";
export const OpenAiChatGptBaseUrl = "https://chatgpt.com/backend-api";
export const OpenAiChatGptResponsesApiBaseUrl = "https://chatgpt.com/backend-api/codex";

export const OpenAiApiKeyTargetConfigSchema = z
  .object({
    api_base_url: OpenAiApiBaseUrlSchema,
    auth_base_url: OpenAiApiBaseUrlSchema.optional(),
  })
  .strict()
  .transform((input) => ({
    apiBaseUrl: input.api_base_url,
    ...(input.auth_base_url === undefined ? {} : { authBaseUrl: input.auth_base_url }),
  }));

export type OpenAiApiKeyTargetConfig = z.output<typeof OpenAiApiKeyTargetConfigSchema>;

export function resolveOpenAiRouteBaseUrlForConnectionMethod(input: {
  targetConfig: OpenAiApiKeyTargetConfig;
  connectionMethod: string;
}): string {
  if (!isOpenAiConnectionMethodId(input.connectionMethod)) {
    throw new Error(`Unsupported OpenAI connection method '${input.connectionMethod}'.`);
  }

  if (input.connectionMethod === OpenAiConnectionMethodIds.API_KEY) {
    return input.targetConfig.apiBaseUrl;
  }

  if (input.connectionMethod === OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE) {
    return OpenAiChatGptOriginBaseUrl;
  }

  throw new Error("Unsupported OpenAI connection method.");
}

export function resolveOpenAiResponsesApiBaseUrlForConnectionMethod(input: {
  targetConfig: OpenAiApiKeyTargetConfig;
  connectionMethod: string;
}): string {
  if (!isOpenAiConnectionMethodId(input.connectionMethod)) {
    throw new Error(`Unsupported OpenAI connection method '${input.connectionMethod}'.`);
  }

  if (input.connectionMethod === OpenAiConnectionMethodIds.API_KEY) {
    return input.targetConfig.apiBaseUrl;
  }

  if (input.connectionMethod === OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE) {
    return OpenAiChatGptResponsesApiBaseUrl;
  }

  throw new Error("Unsupported OpenAI connection method.");
}

export function resolveOpenAiChatGptBaseUrlForConnectionMethod(input: {
  connectionMethod: string;
}): string | undefined {
  if (!isOpenAiConnectionMethodId(input.connectionMethod)) {
    throw new Error(`Unsupported OpenAI connection method '${input.connectionMethod}'.`);
  }

  if (input.connectionMethod === OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE) {
    return OpenAiChatGptBaseUrl;
  }

  return undefined;
}
