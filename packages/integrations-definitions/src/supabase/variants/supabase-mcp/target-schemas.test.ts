import { describe, expect, it } from "vitest";

import { SupabaseTargetConfigSchema } from "./target-config-schema.js";
import { SupabaseTargetSecretSchema } from "./target-secret-schema.js";

describe("Supabase target schemas", () => {
  it("accepts empty target config and target secrets", () => {
    expect(SupabaseTargetConfigSchema.parse({})).toEqual({});
    expect(SupabaseTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config and secret fields", () => {
    expect(() => SupabaseTargetConfigSchema.parse({ unexpected: true })).toThrow(
      /Unrecognized key/u,
    );
    expect(() => SupabaseTargetSecretSchema.parse({ unexpected: "value" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
