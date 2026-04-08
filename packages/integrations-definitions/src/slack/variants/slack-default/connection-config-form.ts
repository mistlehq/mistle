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
