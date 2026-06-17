import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

import { GoogleWorkspaceConnectionMethodIds } from "./auth.js";

export const GoogleWorkspaceServiceAccountConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: GoogleWorkspaceConnectionMethodIds.SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION,
      },
      delegated_user_email: {
        title: "User email",
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
    delegated_user_email: {
      "ui:placeholder": "user@example.com",
    },
  },
};
