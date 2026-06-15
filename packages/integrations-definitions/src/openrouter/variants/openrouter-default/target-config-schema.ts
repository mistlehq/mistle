import { z } from "zod";

export const OpenRouterApiBaseUrl = "https://openrouter.ai/api/v1";
export const OpenRouterApiHost = "openrouter.ai";
export const OpenRouterApiPathPrefix = "/api/v1";

export const OpenRouterTargetConfigSchema = z.object({}).strict();

export type OpenRouterTargetConfig = z.output<typeof OpenRouterTargetConfigSchema>;
