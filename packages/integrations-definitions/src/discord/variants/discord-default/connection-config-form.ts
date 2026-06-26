import type { IntegrationFormDefinition } from "@mistle/integrations-core";

export const DiscordConnectionConfigForm: IntegrationFormDefinition = {
  schema: {
    properties: {
      connection_method: {
        type: "string",
        const: "discord-bot",
      },
      application_id: {
        type: "string",
        title: "Application ID",
      },
    },
    required: ["connection_method"],
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
    application_id: {
      "ui:placeholder": "Discord application ID",
      "ui:help": "Optional Discord application ID for setup and callback verification context.",
    },
  },
};
