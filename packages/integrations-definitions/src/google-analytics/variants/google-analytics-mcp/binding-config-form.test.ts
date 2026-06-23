import { describe, expect, it } from "vitest";

import { resolveGoogleAnalyticsBindingConfigForm } from "./binding-config-form.js";
import { GoogleAnalyticsToolIds } from "./tool-ids.js";

describe("resolveGoogleAnalyticsBindingConfigForm", () => {
  it("presents Google Analytics CLI and MCP tool selection with MCP enabled by default", () => {
    expect(
      resolveGoogleAnalyticsBindingConfigForm({
        familyId: "google-analytics",
        variantId: "google-analytics-mcp",
        kind: "connector",
      }),
    ).toEqual({
      schema: {
        properties: {
          tools: {
            title: "Tools",
            default: [GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_MCP],
            items: {
              type: "string",
              enum: [
                GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_CLI,
                GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_MCP,
              ],
            },
            type: "array",
            uniqueItems: true,
          },
        },
      },
      uiSchema: {
        tools: {
          "ui:enumNames": ["Google Analytics CLI", "Google Analytics MCP"],
          "ui:widget": "checkboxes",
          "ui:options": {
            inline: false,
          },
        },
      },
    });
  });
});
