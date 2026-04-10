import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveLinearBindingConfigForm } from "./binding-config-form.js";
import { LinearBindingConfigSchema } from "./binding-config-schema.js";
import { LinearToolIds } from "./tool-ids.js";

describe("linear binding config forms", () => {
  it("resolves optional Linear MCP tool selection", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: LinearBindingConfigSchema,
      form: resolveLinearBindingConfigForm,
      context: {
        familyId: "linear",
        variantId: "linear-default",
        kind: "connector",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        tools: {
          title: "Tools",
          default: [],
          items: {
            type: "string",
            enum: [LinearToolIds.LINEAR_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      tools: {
        "ui:enumNames": ["Linear MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    });
  });
});
