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
      },
      roleArn: {
        title: "Role ARN",
      },
      externalId: {
        title: "External ID",
      },
      durationSeconds: {
        title: "Duration seconds",
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
      "ui:placeholder": "3600",
    },
  },
};
