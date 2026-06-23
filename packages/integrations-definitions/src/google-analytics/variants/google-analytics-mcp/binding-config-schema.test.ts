import { describe, expect, it } from "vitest";

import { GoogleAnalyticsBindingConfigSchema } from "./binding-config-schema.js";
import { GoogleAnalyticsToolIds } from "./tool-ids.js";

describe("GoogleAnalyticsBindingConfigSchema", () => {
  it("defaults to no enabled tools", () => {
    expect(GoogleAnalyticsBindingConfigSchema.parse({})).toEqual({
      tools: [],
    });
  });

  it("accepts the Google Analytics CLI and MCP tool ids", () => {
    expect(
      GoogleAnalyticsBindingConfigSchema.parse({
        tools: [
          GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_CLI,
          GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_MCP,
        ],
      }),
    ).toEqual({
      tools: [
        GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_CLI,
        GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_MCP,
      ],
    });
  });

  it("rejects unknown Google Analytics tool ids", () => {
    expect(() =>
      GoogleAnalyticsBindingConfigSchema.parse({
        tools: ["unknown-tool"],
      }),
    ).toThrow(/Invalid option/u);
  });
});
