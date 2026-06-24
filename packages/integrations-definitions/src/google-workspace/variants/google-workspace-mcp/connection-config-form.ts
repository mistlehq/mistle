import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

import { GoogleWorkspaceConnectionMethodIds } from "./auth.js";

export const GoogleWorkspaceServiceAccountConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: GoogleWorkspaceConnectionMethodIds.SERVICE_ACCOUNT,
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
  },
};
