import {
  IntegrationConnectionMethodIds,
  type ResolvedIntegrationForm,
} from "@mistle/integrations-core";

export function resolveInceptionBindingConfigForm(): ResolvedIntegrationForm {
  return {
    schema: {},
  };
}

export const InceptionConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: IntegrationConnectionMethodIds.API_KEY,
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
  },
};
