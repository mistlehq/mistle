import { describe, expect, it } from "vitest";

import { ModalSandboxRuntimeConnectionConfigSchema } from "./schemas.js";

describe("ModalSandboxRuntimeConnectionConfigSchema", () => {
  it("accepts the persisted API key connection method", () => {
    expect(
      ModalSandboxRuntimeConnectionConfigSchema.parse({
        connection_method: "api-key",
      }),
    ).toEqual({
      connection_method: "api-key",
    });
  });
});
