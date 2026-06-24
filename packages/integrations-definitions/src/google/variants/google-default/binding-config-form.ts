import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { GoogleCapabilityCatalog, GoogleCapabilityGroups } from "./capabilities/catalog.js";

type GoogleBindingFormContext = IntegrationFormContext;

export function resolveGoogleBindingConfigForm(
  _input: GoogleBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        capabilities: {
          title: "Google tools",
          default: [],
          items: {
            type: "string",
            enum: GoogleCapabilityCatalog.map((capability) => capability.id),
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      capabilities: {
        "ui:enumNames": GoogleCapabilityCatalog.map((capability) => capability.label),
        "ui:widget": "grouped-checkboxes",
        "ui:options": {
          groups: GoogleCapabilityGroups.map((group) => ({
            label: group.label,
            values: [...group.capabilityIds],
          })),
          layout: "stacked",
        },
      },
    },
  };
}
