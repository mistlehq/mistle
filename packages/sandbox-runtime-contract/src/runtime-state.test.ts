import { describe, expect, it } from "vitest";

import runtimeStateSchemaJson from "../schemas/sandbox-runtime-state-snapshot.schema.json" with { type: "json" };
import runtimeStateFixture from "../tests/fixtures/runtime-state.valid.json" with { type: "json" };
import { SandboxRuntimeStateSnapshotSchema } from "./runtime-state.js";

describe("runtime-state contracts", () => {
  it("parses the checked-in runtime-state fixture", () => {
    expect(SandboxRuntimeStateSnapshotSchema.parse(runtimeStateFixture)).toEqual(
      runtimeStateFixture,
    );
  });

  it("matches the checked-in runtime-state json schema", () => {
    expect(SandboxRuntimeStateSnapshotSchema.toJSONSchema()).toEqual(runtimeStateSchemaJson);
  });
});
