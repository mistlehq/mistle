import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

import { SlackConnectionMethodIds } from "./auth.js";

export const SlackBotTokenConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: SlackConnectionMethodIds.SLACK_BOT_TOKEN,
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
  },
};

export const SlackAppOAuthConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: SlackConnectionMethodIds.SLACK_APP_OAUTH,
      },
      client_id: {
        title: "Client ID (Linked User Auth)",
        description:
          "Required only for Identity Linking / linked user authorization. Not required for bot-token-only Slack usage.",
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
  },
};
