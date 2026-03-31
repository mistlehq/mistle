import { describe, expect, it } from "vitest";

import { AwsBindingConfigSchema } from "./binding-config-schema.js";

describe("AWS binding config schema", () => {
  it("parses a valid AWS binding config", () => {
    expect(
      AwsBindingConfigSchema.parse({
        services: ["sts", "s3"],
        regions: ["us-east-1", "us-west-2"],
        defaultRegion: "us-east-1",
      }),
    ).toEqual({
      services: ["sts", "s3"],
      regions: ["us-east-1", "us-west-2"],
      defaultRegion: "us-east-1",
    });
  });

  it("rejects a default region outside the selected regions", () => {
    expect(() =>
      AwsBindingConfigSchema.parse({
        services: ["sts"],
        regions: ["us-east-1"],
        defaultRegion: "eu-west-1",
      }),
    ).toThrow("Default region must be one of the selected regions.");
  });
});
