import { describe, expect, it } from "vitest";

import { NotionTargetConfigSchema } from "./target-config-schema.js";

describe("NotionTargetConfigSchema", () => {
  it("parses raw snake_case target config into camelCase values", () => {
    expect(
      NotionTargetConfigSchema.parse({
        mcp_base_url: "https://notion-mcp.example.com/mcp",
        authorization_endpoint: "https://api.notion.com/v1/oauth/authorize",
        token_endpoint: "https://api.notion.com/v1/oauth/token",
        notion_version: "2026-03-11",
      }),
    ).toEqual({
      mcpBaseUrl: "https://notion-mcp.example.com/mcp",
      authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
      tokenEndpoint: "https://api.notion.com/v1/oauth/token",
      notionVersion: "2026-03-11",
    });
  });
});
