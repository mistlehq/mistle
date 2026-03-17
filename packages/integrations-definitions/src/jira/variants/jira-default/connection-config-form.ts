import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

export const JiraConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      auth_scheme: {
        default: "api-key",
      },
    },
  },
  uiSchema: {
    auth_scheme: {
      "ui:widget": "hidden",
    },
  },
};
