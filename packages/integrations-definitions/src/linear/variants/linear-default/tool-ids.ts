export const LinearToolIds = {
  LINEAR_MCP: "linear-mcp",
} as const;

export type LinearToolId = (typeof LinearToolIds)[keyof typeof LinearToolIds];
