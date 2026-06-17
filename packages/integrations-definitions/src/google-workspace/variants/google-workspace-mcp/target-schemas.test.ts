import { describe, expect, it } from "vitest";

import { GoogleWorkspaceTargetConfigSchema } from "./target-config-schema.js";
import { GoogleWorkspaceTargetSecretSchema } from "./target-secret-schema.js";

describe("Google Workspace target schemas", () => {
  it("accepts empty target config and target secrets", () => {
    expect(GoogleWorkspaceTargetConfigSchema.parse({})).toEqual({});
    expect(GoogleWorkspaceTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config and target secret fields", () => {
    expect(() => GoogleWorkspaceTargetConfigSchema.parse({ unexpected: true })).toThrow(
      /Unrecognized key/,
    );
    expect(() => GoogleWorkspaceTargetSecretSchema.parse({ unexpected: "value" })).toThrow(
      /Unrecognized key/,
    );
  });
});
