import { describe, expect, it } from "vitest";

import { AwsTargetConfigSchema } from "./target-config-schema.js";

describe("AwsTargetConfigSchema", () => {
  it("normalizes the optional STS endpoint URL", () => {
    expect(
      AwsTargetConfigSchema.parse({
        sts_endpoint_url: "http://127.0.0.1:4566/",
      }),
    ).toEqual({
      stsEndpointUrl: "http://127.0.0.1:4566",
    });
  });

  it("rejects unknown target config fields", () => {
    expect(() =>
      AwsTargetConfigSchema.parse({
        sts_endpoint_url: "http://127.0.0.1:4566",
        unknown: true,
      }),
    ).toThrow("unknown");
  });
});
