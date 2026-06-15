import { describe, expect, it } from "vitest";

import { NotionTargetConfigSchema } from "./target-config-schema.js";
import { NotionTargetSecretSchema } from "./target-secret-schema.js";

describe("Notion target schemas", () => {
  it("accepts empty target config and target secrets", () => {
    expect(NotionTargetConfigSchema.parse({})).toEqual({});
    expect(NotionTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config and secret fields", () => {
    expect(() => NotionTargetConfigSchema.parse({ unexpected: true })).toThrow(/Unrecognized key/u);
    expect(() => NotionTargetSecretSchema.parse({ unexpected: "value" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
