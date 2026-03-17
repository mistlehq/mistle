import { z } from "zod";

const RawNotionTargetConfigSchema = z
  .object({
    mcp_base_url: z.url(),
    authorization_endpoint: z.url(),
    token_endpoint: z.url(),
    notion_version: z.string().min(1),
  })
  .strict();

export const NotionTargetConfigSchema = RawNotionTargetConfigSchema.transform((rawConfig) => ({
  mcpBaseUrl: rawConfig.mcp_base_url,
  authorizationEndpoint: rawConfig.authorization_endpoint,
  tokenEndpoint: rawConfig.token_endpoint,
  notionVersion: rawConfig.notion_version,
}));

export type NotionTargetConfig = z.output<typeof NotionTargetConfigSchema>;
