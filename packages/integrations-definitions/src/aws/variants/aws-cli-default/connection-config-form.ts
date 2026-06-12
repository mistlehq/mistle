import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

import { AwsConnectionMethodIds } from "./auth.js";

export const AwsAssumeRoleConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: AwsConnectionMethodIds.AWS_ASSUME_ROLE,
      },
      accessKeyId: {
        title: "Access key ID",
        description:
          "Source IAM access key used to request temporary credentials with STS AssumeRole. The assumed role controls sandbox permissions.",
      },
      roleArn: {
        title: "Role ARN",
        description:
          "IAM role that Mistle should assume for sandbox AWS access. Its trust policy must allow the source access key principal.",
      },
      externalId: {
        title: "External ID",
        description:
          "Optional value required by some IAM role trust policies. Leave blank unless the role checks sts:ExternalId.",
      },
      durationSeconds: {
        title: "Duration seconds",
        description:
          "Optional STS session lifetime in seconds. Leave blank to use the AWS default; set 900-43200 only if the role allows it.",
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
    accessKeyId: {
      "ui:placeholder": "AKIA...",
    },
    roleArn: {
      "ui:placeholder": "arn:aws:iam::123456789012:role/mistle-dev",
    },
    externalId: {
      "ui:placeholder": "Optional external ID",
    },
    durationSeconds: {
      "ui:placeholder": "Optional AWS default",
    },
  },
};
