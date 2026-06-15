import { z } from "zod";

export const DeepSeekApiBaseUrl = "https://api.deepseek.com";
export const DeepSeekApiHost = "api.deepseek.com";
export const DeepSeekApiPathPrefix = "/";

export const DeepSeekTargetConfigSchema = z.object({}).strict();

export type DeepSeekTargetConfig = z.output<typeof DeepSeekTargetConfigSchema>;
