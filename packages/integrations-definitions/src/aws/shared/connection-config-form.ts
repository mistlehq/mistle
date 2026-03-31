import {
  IntegrationConnectionMethodIds,
  type ResolvedIntegrationForm,
} from "@mistle/integrations-core";

export const AwsAssumeRoleConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
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
        description: "Requested AWS STS session duration in seconds.",
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
      "ui:placeholder": "arn:aws:iam::123456789012:role/mistle-sandbox",
    },
    externalId: {
      "ui:placeholder": "Optional external ID",
    },
    durationSeconds: {
      "ui:widget": "updown",
    },
  },
};
