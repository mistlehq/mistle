import { z } from "zod";

export const MiniMaxApiBaseUrl = "https://api.minimaxi.com/v1";
export const MiniMaxApiHost = "api.minimaxi.com";
export const MiniMaxApiPathPrefix = "/v1";
export const MiniMaxAnthropicApiBaseUrl = "https://api.minimaxi.com/anthropic/v1";
export const MiniMaxAnthropicApiPathPrefix = "/anthropic/v1";

export const MiniMaxTargetConfigSchema = z.object({}).strict();

export type MiniMaxTargetConfig = z.output<typeof MiniMaxTargetConfigSchema>;
