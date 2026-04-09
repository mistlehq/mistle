import { describe, expect, it } from "vitest";

import { AwsBindingConfigSchema } from "./binding-config-schema.js";
import { AwsToolIds } from "./tool-ids.js";

describe("AwsBindingConfigSchema", () => {
  it("parses aws binding config with optional aws cli tool selection", () => {
    expect(
      AwsBindingConfigSchema.parse({
        services: ["secretsmanager", "sts"],
        regions: ["us-east-1", "us-west-2"],
        defaultRegion: "us-east-1",
        tools: [AwsToolIds.AWS_CLI],
      }),
    ).toEqual({
      services: ["secretsmanager", "sts"],
      regions: ["us-east-1", "us-west-2"],
      defaultRegion: "us-east-1",
      tools: [AwsToolIds.AWS_CLI],
    });
  });

  it("rejects default regions that are not in the allowed region list", () => {
    expect(() =>
      AwsBindingConfigSchema.parse({
        services: ["secretsmanager"],
        regions: ["us-west-2"],
        defaultRegion: "us-east-1",
      }),
    ).toThrow("Default region must be included in the selected regions.");
  });

  it("rejects unsupported AWS service ids", () => {
    expect(() =>
      AwsBindingConfigSchema.parse({
        services: ["not-a-service"],
        regions: ["us-east-1"],
        defaultRegion: "us-east-1",
      }),
    ).toThrow("Unsupported AWS service id 'not-a-service'.");
  });

  it("rejects unsupported AWS region ids", () => {
    expect(() =>
      AwsBindingConfigSchema.parse({
        services: ["secretsmanager"],
        regions: ["antarctica-south-1"],
        defaultRegion: "antarctica-south-1",
      }),
    ).toThrow("Unsupported AWS region 'antarctica-south-1'.");
  });
});
