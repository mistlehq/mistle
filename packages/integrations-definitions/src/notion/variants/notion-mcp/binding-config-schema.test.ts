import { describe, expect, it } from "vitest";

import { NotionBindingConfigSchema } from "./binding-config-schema.js";

describe("NotionBindingConfigSchema", () => {
  it("defaults optional tool selections to Notion MCP", () => {
    expect(NotionBindingConfigSchema.parse({})).toEqual({
      tools: ["notion-mcp"],
    });
  });

  it("rejects unknown tool identifiers", () => {
    expect(() =>
      NotionBindingConfigSchema.parse({
        tools: ["notion-api"],
      }),
    ).toThrow(/Invalid input/u);
  });
});
