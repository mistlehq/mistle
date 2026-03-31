import { describe, expect, it } from "vitest";

import { AwsAssumeRoleConnectionConfigSchema } from "./auth.js";

describe("AWS assume-role connection config schema", () => {
  it("parses a valid assume-role connection config", () => {
    expect(
      AwsAssumeRoleConnectionConfigSchema.parse({
        connection_method: "aws-assume-role",
        accessKeyId: "AKIA1234567890",
        roleArn: "arn:aws:iam::123456789012:role/mistle-sandbox",
        externalId: "external-123",
        durationSeconds: 3600,
      }),
    ).toEqual({
      connection_method: "aws-assume-role",
      accessKeyId: "AKIA1234567890",
      roleArn: "arn:aws:iam::123456789012:role/mistle-sandbox",
      externalId: "external-123",
      durationSeconds: 3600,
    });
  });

  it("rejects unsupported session durations", () => {
    expect(() =>
      AwsAssumeRoleConnectionConfigSchema.parse({
        connection_method: "aws-assume-role",
        accessKeyId: "AKIA1234567890",
        roleArn: "arn:aws:iam::123456789012:role/mistle-sandbox",
        durationSeconds: 60,
      }),
    ).toThrow(/Too small/u);

    expect(() =>
      AwsAssumeRoleConnectionConfigSchema.parse({
        connection_method: "aws-assume-role",
        accessKeyId: "AKIA1234567890",
        roleArn: "arn:aws:iam::123456789012:role/mistle-sandbox",
        durationSeconds: 50_000,
      }),
    ).toThrow(/Too big/u);
  });
});
