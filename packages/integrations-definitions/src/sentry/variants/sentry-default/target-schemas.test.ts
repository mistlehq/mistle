import { describe, expect, it } from "vitest";

import { SentryTargetConfigSchema } from "./target-config-schema.js";
import { SentryTargetSecretSchema } from "./target-secret-schema.js";

describe("Sentry target schemas", () => {
  it("accepts empty target config and target secrets", () => {
    expect(SentryTargetConfigSchema.parse({})).toEqual({});
    expect(SentryTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config and secret fields", () => {
    expect(() => SentryTargetConfigSchema.parse({ unexpected: true })).toThrow(/Unrecognized key/u);
    expect(() => SentryTargetSecretSchema.parse({ unexpected: "value" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
