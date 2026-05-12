import { z } from "zod";

export const AnthropicApiBaseUrl = "https://api.anthropic.com";
export const AnthropicApiHost = "api.anthropic.com";
export const AnthropicApiPathPrefix = "/v1";

export const AnthropicTargetConfigSchema = z.object({}).strict();

export type AnthropicTargetConfig = z.output<typeof AnthropicTargetConfigSchema>;
