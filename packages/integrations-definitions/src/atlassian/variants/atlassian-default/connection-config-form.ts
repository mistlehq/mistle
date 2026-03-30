import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

import { AtlassianConnectionMethodIds } from "./auth.js";

export const AtlassianPersonalApiTokenConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
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

export const AtlassianServiceAccountApiTokenConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
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
      "ui:placeholder": "Your Atlassian cloud ID",
    },
  },
};
