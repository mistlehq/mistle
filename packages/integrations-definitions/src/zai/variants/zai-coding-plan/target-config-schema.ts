import { z } from "zod";

export const ZaiApiBaseUrl = "https://api.z.ai/api/coding/paas/v4";
export const ZaiApiHost = "api.z.ai";
export const ZaiApiPathPrefix = "/api/coding/paas/v4";

export const ZaiTargetConfigSchema = z.object({}).strict();

export type ZaiTargetConfig = z.output<typeof ZaiTargetConfigSchema>;
