import { describe, expect, it } from "vitest";

import {
  AwsAssumeRoleConnectionConfigSchema,
  AwsConnectionMethodIds,
  AwsCredentialResolverKeys,
  AwsCredentialSecretTypes,
  AwsCredentialSlotKeys,
} from "./auth.js";

describe("aws auth metadata", () => {
  it("parses assume-role connection config", () => {
    expect(
      AwsAssumeRoleConnectionConfigSchema.parse({
        connection_method: AwsConnectionMethodIds.AWS_ASSUME_ROLE,
        accessKeyId: "AKIAEXAMPLE",
        roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
        externalId: "mistle-external-id",
        durationSeconds: 3600,
      }),
    ).toEqual({
      connection_method: AwsConnectionMethodIds.AWS_ASSUME_ROLE,
      accessKeyId: "AKIAEXAMPLE",
      roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
      externalId: "mistle-external-id",
      durationSeconds: 3600,
    });
  });

  it("rejects duration values outside the STS bounds", () => {
    expect(() =>
      AwsAssumeRoleConnectionConfigSchema.parse({
        connection_method: AwsConnectionMethodIds.AWS_ASSUME_ROLE,
        accessKeyId: "AKIAEXAMPLE",
        roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
        durationSeconds: 60,
      }),
    ).toThrow("Too small: expected number to be >=900");
  });

  it("uses dedicated aws secret metadata", () => {
    expect(AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY).toBe("aws_secret_access_key");
    expect(AwsCredentialSlotKeys.SECRET_ACCESS_KEY).toBe(
      "aws.aws-cli-default.aws-assume-role.secret-access-key",
    );
    expect(AwsCredentialResolverKeys.ASSUME_ROLE_SESSION).toBe("assume-role-session");
  });
});
