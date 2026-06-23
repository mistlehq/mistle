import { describe, expect, it } from "vitest";

import { GoogleBusinessProfileBindingConfigSchema } from "./binding-config-schema.js";
import { GoogleBusinessProfileToolIds } from "./tool-ids.js";

describe("GoogleBusinessProfileBindingConfigSchema", () => {
  it("defaults to no enabled tools", () => {
    expect(GoogleBusinessProfileBindingConfigSchema.parse({})).toEqual({
      tools: [],
    });
  });

  it("accepts the Google Business Profile CLI and MCP tool ids", () => {
    expect(
      GoogleBusinessProfileBindingConfigSchema.parse({
        tools: [
          GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_CLI,
          GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_MCP,
        ],
      }),
    ).toEqual({
      tools: [
        GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_CLI,
        GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_MCP,
      ],
    });
  });

  it("rejects unknown Google Business Profile tool ids", () => {
    expect(() =>
      GoogleBusinessProfileBindingConfigSchema.parse({
        tools: ["unknown-tool"],
      }),
    ).toThrow(/Invalid option/u);
  });
});
