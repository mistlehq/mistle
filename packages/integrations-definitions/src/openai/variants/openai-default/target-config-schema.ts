import { z } from "zod";

import {
  OpenAiCapabilitiesSchema,
  OpenAiConnectionMethodIds,
  OpenAiModelIds,
  isOpenAiConnectionMethodId,
} from "./model-capabilities.js";

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

const OpenAiRawCapabilitySetSchema = z
  .object({
    models: z.array(z.enum(OpenAiModelIds)).min(1),
    allowed_reasoning_by_model: z.record(
      z.enum(OpenAiModelIds),
      z.array(z.enum(["low", "medium", "high", "xhigh"])).min(1),
    ),
    default_reasoning_by_model: z.record(
      z.enum(OpenAiModelIds),
      z.enum(["low", "medium", "high", "xhigh"]),
    ),
  })
  .strict();

const OpenAiRawBindingCapabilitiesSchema = OpenAiRawCapabilitySetSchema.transform((input) =>
  OpenAiCapabilitiesSchema.parse({
    models: input.models,
    allowedReasoningByModel: input.allowed_reasoning_by_model,
    defaultReasoningByModel: input.default_reasoning_by_model,
  }),
);

const OpenAiBindingCapabilitiesByConnectionMethodSchema = z
  .object({
    [OpenAiConnectionMethodIds.API_KEY]: OpenAiRawBindingCapabilitiesSchema,
    [OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE]: OpenAiRawBindingCapabilitiesSchema,
  })
  .strict();

export const OpenAiChatGptResponsesApiBaseUrl = "https://chatgpt.com/backend-api/codex";

export const OpenAiApiKeyTargetConfigSchema = z
  .object({
    api_base_url: OpenAiApiBaseUrlSchema,
    binding_capabilities_by_connection_method: OpenAiBindingCapabilitiesByConnectionMethodSchema,
  })
  .strict()
  .transform((input) => ({
    apiBaseUrl: input.api_base_url,
    bindingCapabilitiesByConnectionMethod: input.binding_capabilities_by_connection_method,
  }));

export type OpenAiApiKeyTargetConfig = z.output<typeof OpenAiApiKeyTargetConfigSchema>;

export function resolveOpenAiApiBaseUrlForConnectionMethod(input: {
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
