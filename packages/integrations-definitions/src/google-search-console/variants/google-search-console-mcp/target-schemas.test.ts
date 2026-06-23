import { describe, expect, it } from "vitest";

import { GoogleSearchConsoleTargetConfigSchema } from "./target-config-schema.js";
import { GoogleSearchConsoleTargetSecretSchema } from "./target-secret-schema.js";

describe("Google Search Console target schemas", () => {
  it("accepts empty target config and rejects unknown config fields", () => {
    expect(GoogleSearchConsoleTargetConfigSchema.parse({})).toEqual({});
    expect(() =>
      GoogleSearchConsoleTargetConfigSchema.parse({ api_base_url: "https://example.com" }),
    ).toThrow(/Unrecognized key/u);
  });

  it("accepts empty target secrets and rejects unknown secret fields", () => {
    expect(GoogleSearchConsoleTargetSecretSchema.parse({})).toEqual({});
    expect(() => GoogleSearchConsoleTargetSecretSchema.parse({ token: "secret" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
