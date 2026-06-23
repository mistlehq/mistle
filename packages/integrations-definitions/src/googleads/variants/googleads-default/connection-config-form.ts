import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

export const GoogleAdsConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: IntegrationConnectionMethodIds.API_KEY,
      },
      login_customer_id: {
        title: "Login customer ID",
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
    login_customer_id: {
      "ui:placeholder": "Optional manager customer ID",
    },
  },
};
