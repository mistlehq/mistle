import { z } from "zod";

export const RenderMcpBaseUrl = "https://mcp.render.com/mcp";

export function resolveRenderMcpUrl(): string {
  return RenderMcpBaseUrl;
}

export const RenderTargetConfigSchema = z.object({}).strict();

export type RenderTargetConfig = z.output<typeof RenderTargetConfigSchema>;
