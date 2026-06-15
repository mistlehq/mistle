import { z } from "zod";

export const InceptionApiBaseUrl = "https://api.inceptionlabs.ai/v1";
export const InceptionApiHost = "api.inceptionlabs.ai";
export const InceptionApiPathPrefix = "/v1";

export const InceptionTargetConfigSchema = z.object({}).strict();

export type InceptionTargetConfig = z.output<typeof InceptionTargetConfigSchema>;
