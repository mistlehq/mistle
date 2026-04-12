import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveDatadogBindingConfigForm } from "./binding-config-form.js";
import { DatadogBindingConfigSchema } from "./binding-config-schema.js";
import { DatadogToolIds } from "./tool-ids.js";

describe("datadog binding config forms", () => {
  it("defaults Datadog MCP to selected", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: DatadogBindingConfigSchema,
      form: resolveDatadogBindingConfigForm,
      context: {
        familyId: "datadog",
        variantId: "datadog-default",
        kind: "connector",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        tools: {
          title: "Tools",
          default: [DatadogToolIds.DATADOG_MCP],
          items: {
            type: "string",
            enum: [DatadogToolIds.DATADOG_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      tools: {
        "ui:enumNames": ["Datadog MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    });
  });
});
