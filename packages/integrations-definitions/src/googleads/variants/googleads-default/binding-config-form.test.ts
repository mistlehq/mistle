import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveGoogleAdsBindingConfigForm } from "./binding-config-form.js";
import { GoogleAdsBindingConfigSchema } from "./binding-config-schema.js";
import { GoogleAdsToolIds } from "./tool-ids.js";

describe("meta ads binding config forms", () => {
  it("defaults Google Ads MCP to selected", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: GoogleAdsBindingConfigSchema,
      form: resolveGoogleAdsBindingConfigForm,
      context: {
        familyId: "googleads",
        variantId: "googleads-default",
        kind: "connector",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        tools: {
          title: "Tools",
          default: [GoogleAdsToolIds.GOOGLEADS_MCP],
          items: {
            type: "string",
            enum: [GoogleAdsToolIds.GOOGLEADS_CLI, GoogleAdsToolIds.GOOGLEADS_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      tools: {
        "ui:enumNames": ["Google Ads CLI", "Google Ads MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    });
  });
});
