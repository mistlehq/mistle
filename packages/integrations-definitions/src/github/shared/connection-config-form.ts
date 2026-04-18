import type { ResolvedIntegrationForm } from "@mistle/integrations-core";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";

export const GitHubApiKeyConnectionConfigForm: ResolvedIntegrationForm = {
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

export const GitHubAppInstallationConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      },
      app_id: {
        title: "App ID",
      },
      app_slug: {
        title: "App slug",
      },
      client_id: {
        title: "Client ID (Linked User Auth)",
        description:
          "Required only for Identity Linking / linked user authorization. Not required for installation-only GitHub App usage.",
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
    installation_id: {
      "ui:widget": "hidden",
    },
    setup_action: {
      "ui:widget": "hidden",
    },
  },
};
