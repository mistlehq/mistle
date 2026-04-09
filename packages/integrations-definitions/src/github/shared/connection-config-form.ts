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
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
  },
};
