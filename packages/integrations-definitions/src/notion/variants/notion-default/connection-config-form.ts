import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

export const NotionConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: "oauth2",
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
  },
};
