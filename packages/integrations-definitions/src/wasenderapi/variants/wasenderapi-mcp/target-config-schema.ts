import { z } from "zod";

export const WasenderApiMcpBaseUrl = "https://wasenderapi.com/mcp";

export function resolveWasenderApiMcpUrl(): string {
  return WasenderApiMcpBaseUrl;
}

export const WasenderApiTargetConfigSchema = z.object({}).strict();

export type WasenderApiTargetConfig = z.output<typeof WasenderApiTargetConfigSchema>;
