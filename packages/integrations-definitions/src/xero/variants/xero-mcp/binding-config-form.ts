import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

import { XeroOAuthScopes } from "./auth.js";
import { XeroToolIds } from "./tool-ids.js";

export function resolveXeroBindingConfigForm(): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [XeroToolIds.XERO_MCP],
          items: {
            type: "string",
            enum: [XeroToolIds.XERO_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Xero MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}

export const XeroConnectionStartConfigForm: ResolvedIntegrationForm = {
  schema: {
    type: "object",
    properties: {
      client_id: {
        type: "string",
        title: "OAuth client ID",
      },
      client_secret: {
        type: "string",
        title: "OAuth client secret",
      },
      scopes: {
        type: "array",
        title: "OAuth scopes",
        description:
          "Add the Xero API scopes required by the endpoints this connection should use.",
        default: [...XeroOAuthScopes],
        items: {
          type: "string",
        },
        uniqueItems: true,
      },
    },
    required: ["client_id", "client_secret"],
  },
  uiSchema: {
    client_secret: {
      "ui:widget": "password",
    },
  },
};
