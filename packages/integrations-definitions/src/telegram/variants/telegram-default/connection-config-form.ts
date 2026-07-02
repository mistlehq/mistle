import type { IntegrationFormDefinition } from "@mistle/integrations-core";

import { TelegramConnectionMethodId } from "./auth.js";

export const TelegramConnectionConfigForm: IntegrationFormDefinition = {
  schema: {
    properties: {
      connection_method: {
        type: "string",
        const: TelegramConnectionMethodId,
      },
    },
    required: ["connection_method"],
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
  },
};
