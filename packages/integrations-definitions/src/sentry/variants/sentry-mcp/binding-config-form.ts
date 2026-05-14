import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { SentryToolIds } from "./tool-ids.js";

type SentryBindingFormContext = IntegrationFormContext;

export function resolveSentryBindingConfigForm(
  _input: SentryBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [SentryToolIds.SENTRY_MCP],
          items: {
            type: "string",
            enum: [SentryToolIds.SENTRY_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["Sentry MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
