import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { PostHogToolIds } from "./tool-ids.js";

type PostHogBindingFormContext = IntegrationFormContext;

export function resolvePostHogBindingConfigForm(
  _input: PostHogBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        tools: {
          title: "Tools",
          default: [PostHogToolIds.POSTHOG_MCP],
          items: {
            type: "string",
            enum: [PostHogToolIds.POSTHOG_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      tools: {
        "ui:enumNames": ["PostHog MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
