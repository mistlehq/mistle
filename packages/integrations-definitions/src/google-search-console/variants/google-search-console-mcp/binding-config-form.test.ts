import { describe, expect, it } from "vitest";

import { resolveGoogleSearchConsoleBindingConfigForm } from "./binding-config-form.js";
import { GoogleSearchConsoleToolIds } from "./tool-ids.js";

describe("resolveGoogleSearchConsoleBindingConfigForm", () => {
  it("presents Google Search Console CLI and MCP tool selection with MCP enabled by default", () => {
    expect(
      resolveGoogleSearchConsoleBindingConfigForm({
        familyId: "google-search-console",
        variantId: "google-search-console-mcp",
        kind: "connector",
      }),
    ).toEqual({
      schema: {
        properties: {
          tools: {
            title: "Tools",
            default: [GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_MCP],
            items: {
              type: "string",
              enum: [
                GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_CLI,
                GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_MCP,
              ],
            },
            type: "array",
            uniqueItems: true,
          },
        },
      },
      uiSchema: {
        tools: {
          "ui:enumNames": ["Google Search Console CLI", "Google Search Console MCP"],
          "ui:widget": "checkboxes",
          "ui:options": {
            inline: false,
          },
        },
      },
    });
  });
});
