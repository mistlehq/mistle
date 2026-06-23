import { describe, expect, it } from "vitest";

import { AutumnTargetConfigSchema } from "./target-config-schema.js";
import { AutumnTargetSecretSchema } from "./target-secret-schema.js";

describe("Autumn target schemas", () => {
  it("does not require target-level config or secrets", () => {
    expect(AutumnTargetConfigSchema.parse({})).toEqual({});
    expect(AutumnTargetSecretSchema.parse({})).toEqual({});
  });
});
