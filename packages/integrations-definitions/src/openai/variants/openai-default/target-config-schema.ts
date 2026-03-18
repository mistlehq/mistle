import { z } from "zod";

import { OpenAiCapabilitiesSchema, OpenAiModelIds } from "./model-capabilities.js";

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

export const OpenAiApiKeyTargetConfigSchema = z
  .object({
    api_base_url: OpenAiApiBaseUrlSchema,
    binding_capabilities: OpenAiRawBindingCapabilitiesSchema,
  })
  .strict()
  .transform((input) => ({
    apiBaseUrl: input.api_base_url,
    bindingCapabilities: input.binding_capabilities,
  }));

export type OpenAiApiKeyTargetConfig = z.output<typeof OpenAiApiKeyTargetConfigSchema>;
