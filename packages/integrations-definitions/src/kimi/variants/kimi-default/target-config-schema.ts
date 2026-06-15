import { z } from "zod";

export const KimiApiBaseUrl = "https://api.moonshot.ai/v1";
export const KimiApiHost = "api.moonshot.ai";
export const KimiApiPathPrefix = "/v1";

export const KimiTargetConfigSchema = z.object({}).strict();

export type KimiTargetConfig = z.output<typeof KimiTargetConfigSchema>;
