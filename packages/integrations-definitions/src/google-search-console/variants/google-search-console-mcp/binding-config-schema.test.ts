import { describe, expect, it } from "vitest";

import { GoogleSearchConsoleBindingConfigSchema } from "./binding-config-schema.js";
import { GoogleSearchConsoleToolIds } from "./tool-ids.js";

describe("GoogleSearchConsoleBindingConfigSchema", () => {
  it("defaults to no enabled tools", () => {
    expect(GoogleSearchConsoleBindingConfigSchema.parse({})).toEqual({
      tools: [],
    });
  });

  it("accepts the Google Search Console CLI and MCP tool ids", () => {
    expect(
      GoogleSearchConsoleBindingConfigSchema.parse({
        tools: [
          GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_CLI,
          GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_MCP,
        ],
      }),
    ).toEqual({
      tools: [
        GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_CLI,
        GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_MCP,
      ],
    });
  });

  it("rejects unknown Google Search Console tool ids", () => {
    expect(() =>
      GoogleSearchConsoleBindingConfigSchema.parse({
        tools: ["unknown-tool"],
      }),
    ).toThrow(/Invalid option/u);
  });
});
