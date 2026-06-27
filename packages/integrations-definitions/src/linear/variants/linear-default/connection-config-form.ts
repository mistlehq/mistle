import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

export const LinearApiKeyConnectionConfigForm: ResolvedIntegrationForm = {
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

export const LinearOAuthAppConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: "linear-oauth-app",
      },
      client_id: {
        title: "OAuth client ID",
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
    client_id: {
      "ui:placeholder": "Linear OAuth app client ID",
    },
  },
};
