import { z } from "zod";

export const DefaultDatadogMcpBaseUrl = "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp";

function normalizeDatadogMcpBaseUrl(input: string): string {
  const parsedUrl = new URL(input);
  const pathnameWithoutTrailingSlash = parsedUrl.pathname.endsWith("/")
    ? parsedUrl.pathname.slice(0, -1)
    : parsedUrl.pathname;
  const normalizedPathname =
    pathnameWithoutTrailingSlash.length === 0 ? "/" : pathnameWithoutTrailingSlash;

  parsedUrl.pathname = normalizedPathname;
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return normalizedPathname === "/" ? parsedUrl.origin : parsedUrl.toString();
}

export function resolveDatadogMcpUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("toolsets", "all");
  return url.toString();
}

export const DatadogTargetConfigSchema = z
  .object({
    mcp_base_url: z
      .url()
      .default(DefaultDatadogMcpBaseUrl)
      .transform((input) => normalizeDatadogMcpBaseUrl(input)),
  })
  .strict()
  .transform((input) => ({
    mcpBaseUrl: input.mcp_base_url,
  }));

export type DatadogTargetConfig = z.output<typeof DatadogTargetConfigSchema>;
