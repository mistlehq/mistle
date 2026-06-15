import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { BugSnagToolIds } from "./tool-ids.js";

type BugSnagBindingFormContext = IntegrationFormContext;

export function resolveBugSnagBindingConfigForm(
  _input: BugSnagBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [BugSnagToolIds.BUGSNAG_MCP],
          items: {
            type: "string",
            enum: [BugSnagToolIds.BUGSNAG_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["BugSnag MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
