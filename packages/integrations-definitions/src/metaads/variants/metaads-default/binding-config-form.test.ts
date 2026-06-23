import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveMetaAdsBindingConfigForm } from "./binding-config-form.js";
import { MetaAdsBindingConfigSchema } from "./binding-config-schema.js";
import { MetaAdsToolIds } from "./tool-ids.js";

describe("meta ads binding config forms", () => {
  it("defaults Meta Ads MCP to selected", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: MetaAdsBindingConfigSchema,
      form: resolveMetaAdsBindingConfigForm,
      context: {
        familyId: "metaads",
        variantId: "metaads-default",
        kind: "connector",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        tools: {
          title: "Tools",
          default: [MetaAdsToolIds.METAADS_MCP],
          items: {
            type: "string",
            enum: [MetaAdsToolIds.METAADS_CLI, MetaAdsToolIds.METAADS_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      tools: {
        "ui:enumNames": ["Meta Ads CLI", "Meta Ads MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    });
  });
});
