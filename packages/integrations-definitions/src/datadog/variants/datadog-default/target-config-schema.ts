import { z } from "zod";

export const DatadogMcpBaseUrl = "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp";

export function resolveDatadogMcpUrl(): string {
  const url = new URL(DatadogMcpBaseUrl);
  url.searchParams.set("toolsets", "all");
  return url.toString();
}

export const DatadogTargetConfigSchema = z.object({}).strict();

export type DatadogTargetConfig = z.output<typeof DatadogTargetConfigSchema>;
