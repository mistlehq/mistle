import { describe, expect, it } from "vitest";

import { PostHogTargetConfigSchema } from "./target-config-schema.js";
import { PostHogTargetSecretSchema } from "./target-secret-schema.js";

describe("PostHog target schemas", () => {
  it("accepts empty target config and target secrets", () => {
    expect(PostHogTargetConfigSchema.parse({})).toEqual({});
    expect(PostHogTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config and secret fields", () => {
    expect(() => PostHogTargetConfigSchema.parse({ unexpected: true })).toThrow(
      /Unrecognized key/u,
    );
    expect(() => PostHogTargetSecretSchema.parse({ unexpected: "value" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
