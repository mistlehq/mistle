export const ResendToolIds = {
  RESEND_MCP: "resend-mcp",
} as const;

export type ResendToolId = (typeof ResendToolIds)[keyof typeof ResendToolIds];
