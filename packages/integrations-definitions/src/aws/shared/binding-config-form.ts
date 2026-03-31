import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

export const AwsBindingConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      services: {
        title: "Services",
        description: "AWS service IDs to expose in this binding, such as sts or s3.",
        items: {
          title: "Service",
        },
      },
      regions: {
        title: "Regions",
        description: "AWS regions allowed for this binding, such as us-east-1.",
        items: {
          title: "Region",
        },
      },
      defaultRegion: {
        title: "Default region",
        description: "Default AWS region written to the managed CLI config.",
      },
    },
  },
  uiSchema: {
    services: {
      items: {
        "ui:placeholder": "sts",
      },
    },
    regions: {
      items: {
        "ui:placeholder": "us-east-1",
      },
    },
    defaultRegion: {
      "ui:placeholder": "us-east-1",
    },
  },
};
