import { describe, expect, it } from "vitest";

import { AwsAssumeRoleConnectionConfigForm } from "./connection-config-form.js";

describe("AwsAssumeRoleConnectionConfigForm", () => {
  it("explains the AWS assume-role fields that users must configure", () => {
    expect(AwsAssumeRoleConnectionConfigForm.schema).toMatchObject({
      properties: {
        accessKeyId: {
          description: expect.stringContaining("STS AssumeRole"),
        },
        roleArn: {
          description: expect.stringContaining("trust policy"),
        },
        externalId: {
          description: expect.stringContaining("sts:ExternalId"),
        },
        durationSeconds: {
          description: expect.stringContaining("Leave blank to use the AWS default"),
        },
      },
    });
    expect(AwsAssumeRoleConnectionConfigForm.uiSchema).toMatchObject({
      durationSeconds: {
        "ui:placeholder": "Optional AWS default",
      },
    });
  });
});
