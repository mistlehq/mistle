import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

import { SlackConnectionMethodIds } from "./auth.js";

export const SlackAppConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: SlackConnectionMethodIds.SLACK_APP,
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

export const SlackBotTokenConnectionConfigForm = SlackAppConnectionConfigForm;
export const SlackAppOAuthConnectionConfigForm = SlackAppConnectionConfigForm;
