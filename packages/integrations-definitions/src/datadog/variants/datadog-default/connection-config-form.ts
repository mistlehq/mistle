import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

export const DatadogConnectionConfigForm: ResolvedIntegrationForm = {
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
