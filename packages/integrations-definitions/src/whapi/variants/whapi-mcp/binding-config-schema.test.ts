import { describe, expect, it } from "vitest";

import { WhapiBindingConfigSchema } from "./binding-config-schema.js";
import { WhapiToolIds } from "./tool-ids.js";

describe("WhapiBindingConfigSchema", () => {
  it("defaults Whapi MCP to selected", () => {
    expect(WhapiBindingConfigSchema.parse({})).toEqual({
      tools: [WhapiToolIds.WHAPI_MCP],
    });
  });

  it("accepts an explicit empty tool selection", () => {
    expect(WhapiBindingConfigSchema.parse({ tools: [] })).toEqual({
      tools: [],
    });
  });
});
