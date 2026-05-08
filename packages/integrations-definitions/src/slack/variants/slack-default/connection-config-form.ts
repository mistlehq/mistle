import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

import { SlackConnectionMethodId } from "./auth.js";

export const SlackConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: SlackConnectionMethodId,
      },
      app_id: {
        title: "App ID",
        description: "Slack app ID used to refresh webhook event capabilities from Slack.",
      },
      client_id: {
        title: "Client ID (Linked User Auth)",
        description:
          "Required only for Identity Linking / linked user authorization. Not required for standard Slack app bot-token usage.",
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
  },
};
