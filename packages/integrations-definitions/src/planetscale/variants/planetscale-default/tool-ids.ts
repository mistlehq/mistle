export const PlanetScaleToolIds = {
  PLANETSCALE_CLI: "planetscale-cli",
  PLANETSCALE_MCP: "planetscale-mcp",
  PLANETSCALE_INSIGHTS_MCP: "planetscale-insights-mcp",
} as const;

export type PlanetScaleToolId = (typeof PlanetScaleToolIds)[keyof typeof PlanetScaleToolIds];
