import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

import { JiraConnectionMethodIds } from "./auth.js";

export const JiraPersonalApiTokenConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
      },
      site_url: {
        title: "Site URL",
      },
      email: {
        title: "Email",
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
    site_url: {
      "ui:placeholder": "https://your-site.atlassian.net",
    },
    email: {
      "ui:placeholder": "name@example.com",
    },
  },
};

export const JiraServiceAccountApiTokenConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
      },
      cloud_id: {
        title: "Cloud ID",
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
    cloud_id: {
      "ui:placeholder": "Your Jira cloud ID",
    },
  },
};

export const JiraServiceAccountOauthClientCredentialsConnectionConfigForm: ResolvedIntegrationForm =
  {
    schema: {
      properties: {
        connection_method: {
          default: JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
        },
        cloud_id: {
          title: "Cloud ID",
        },
        client_id: {
          title: "Client ID",
        },
      },
    },
    uiSchema: {
      connection_method: {
        "ui:widget": "hidden",
      },
      cloud_id: {
        "ui:placeholder": "Your Jira cloud ID",
      },
      client_id: {
        "ui:placeholder": "Your Jira OAuth 2.0 client ID",
      },
    },
  };
