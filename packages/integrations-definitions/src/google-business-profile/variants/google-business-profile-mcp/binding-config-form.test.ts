import { describe, expect, it } from "vitest";

import { resolveGoogleBusinessProfileBindingConfigForm } from "./binding-config-form.js";
import { GoogleBusinessProfileToolIds } from "./tool-ids.js";

describe("resolveGoogleBusinessProfileBindingConfigForm", () => {
  it("presents Google Business Profile CLI and MCP tool selection with MCP enabled by default", () => {
    expect(
      resolveGoogleBusinessProfileBindingConfigForm({
        familyId: "google-business-profile",
        variantId: "google-business-profile-mcp",
        kind: "connector",
      }),
    ).toEqual({
      schema: {
        properties: {
          tools: {
            title: "Tools",
            default: [GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_MCP],
            items: {
              type: "string",
              enum: [
                GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_CLI,
                GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_MCP,
              ],
            },
            type: "array",
            uniqueItems: true,
          },
        },
      },
      uiSchema: {
        tools: {
          "ui:enumNames": ["Google Business Profile CLI", "Google Business Profile MCP"],
          "ui:widget": "checkboxes",
          "ui:options": {
            inline: false,
          },
        },
      },
    });
  });
});
