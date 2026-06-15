import { z } from "zod";

export const FireworksApiBaseUrl = "https://api.fireworks.ai/inference/v1";
export const FireworksApiHost = "api.fireworks.ai";
export const FireworksApiPathPrefix = "/inference/v1";

export const FireworksTargetConfigSchema = z.object({}).strict();

export type FireworksTargetConfig = z.output<typeof FireworksTargetConfigSchema>;
