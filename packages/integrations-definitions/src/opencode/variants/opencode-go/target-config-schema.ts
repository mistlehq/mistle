import { z } from "zod";

export const OpenCodeGoApiBaseUrl = "https://opencode.ai/zen/go/v1";
export const OpenCodeGoApiHost = "opencode.ai";
export const OpenCodeGoApiPathPrefix = "/zen/go/v1";

export const OpenCodeGoTargetConfigSchema = z.object({}).strict();

export type OpenCodeGoTargetConfig = z.output<typeof OpenCodeGoTargetConfigSchema>;
