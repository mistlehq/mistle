import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

export const AtlassianConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: "api-key",
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
  },
};
