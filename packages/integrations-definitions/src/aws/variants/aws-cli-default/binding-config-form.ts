import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { AwsToolIds } from "./tool-ids.js";

type AwsBindingFormContext = IntegrationFormContext;

export function resolveAwsBindingConfigForm(
  _input: AwsBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        services: {
          title: "Services",
          type: "array",
          items: {
            type: "string",
          },
          default: [],
        },
        regions: {
          title: "Regions",
          type: "array",
          items: {
            type: "string",
          },
          default: [],
        },
        defaultRegion: {
          title: "Default region",
        },
        tools: {
          title: "Tools",
          default: [AwsToolIds.AWS_CLI],
          items: {
            type: "string",
            enum: [AwsToolIds.AWS_CLI],
          },
          type: "array",
          uniqueItems: true,
        },
      },
      required: ["services", "regions", "defaultRegion"],
    },
    uiSchema: {
      services: {
        "ui:help": "Allowed AWS service ids such as secretsmanager, sts, or s3.",
      },
      regions: {
        "ui:help": "Allowed AWS regions such as us-east-1.",
      },
      defaultRegion: {
        "ui:placeholder": "us-east-1",
      },
      tools: {
        "ui:enumNames": ["AWS CLI"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
