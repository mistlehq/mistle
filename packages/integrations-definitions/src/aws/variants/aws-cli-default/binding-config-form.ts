import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import {
  AwsEndpointServiceDefinitions,
  AwsSupportedRegionIds,
  isAwsSupportedRegionId,
} from "../../shared/endpoint-catalog.js";
import { AwsToolIds } from "./tool-ids.js";

type AwsBindingFormContext = IntegrationFormContext;

function resolveSelectedRegions(input: AwsBindingFormContext): readonly string[] {
  const regions = input.currentValue?.regions;
  if (!Array.isArray(regions)) {
    return [];
  }

  return regions.filter(
    (region): region is string => typeof region === "string" && isAwsSupportedRegionId(region),
  );
}

export function resolveAwsBindingConfigForm(input: AwsBindingFormContext): ResolvedIntegrationForm {
  const selectedRegions = resolveSelectedRegions(input);
  const defaultRegionOptions =
    selectedRegions.length > 0 ? selectedRegions : [...AwsSupportedRegionIds];

  return {
    schema: {
      properties: {
        services: {
          title: "Services",
          type: "array",
          items: {
            type: "string",
            enum: AwsEndpointServiceDefinitions.map((definition) => definition.id),
          },
          default: [],
        },
        regions: {
          title: "Regions",
          type: "array",
          items: {
            type: "string",
            enum: [...AwsSupportedRegionIds],
          },
          default: [],
        },
        defaultRegion: {
          title: "Default region",
          oneOf: defaultRegionOptions.map((region) => ({
            const: region,
            title: region,
          })),
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
        "ui:enumNames": AwsEndpointServiceDefinitions.map((definition) => definition.displayName),
        "ui:placeholder": "Search supported AWS services",
        "ui:widget": "multi-select-string-array-combobox",
        "ui:options": {
          emptyMessage: "No matching supported AWS services.",
        },
      },
      regions: {
        "ui:help": "Allowed AWS regions such as us-east-1.",
        "ui:placeholder": "Search supported AWS regions",
        "ui:widget": "multi-select-string-array-combobox",
        "ui:options": {
          emptyMessage: "No matching supported AWS regions.",
        },
      },
      defaultRegion: {
        "ui:placeholder": "Select default region",
        "ui:widget": "single-select-string-combobox",
        "ui:options": {
          emptyMessage:
            selectedRegions.length > 0
              ? "No matching selected regions."
              : "No matching supported AWS regions.",
        },
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
