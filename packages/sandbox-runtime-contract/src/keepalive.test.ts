import { describe, expect, it } from "vitest";

import keepaliveSchemaJson from "../schemas/sandbox-keepalive-state.schema.json" with { type: "json" };
import keepaliveFixture from "../tests/fixtures/keepalive-state.valid.json" with { type: "json" };
import { SandboxKeepaliveStateSchema } from "./keepalive.js";

describe("keepalive contracts", () => {
  it("parses the checked-in keepalive fixture", () => {
    expect(SandboxKeepaliveStateSchema.parse(keepaliveFixture)).toEqual(keepaliveFixture);
  });

  it("matches the checked-in keepalive json schema", () => {
    expect(SandboxKeepaliveStateSchema.toJSONSchema()).toEqual(keepaliveSchemaJson);
  });
});
