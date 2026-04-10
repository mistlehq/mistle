import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolvePlanetScaleBindingConfigForm } from "./binding-config-form.js";
import { PlanetScaleBindingConfigSchema } from "./binding-config-schema.js";

describe("PlanetScale binding config forms", () => {
  it("resolves the selectable PlanetScale tool surfaces", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: PlanetScaleBindingConfigSchema,
      form: resolvePlanetScaleBindingConfigForm,
      context: {
        familyId: "planetscale",
        variantId: "planetscale-default",
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
            enum: ["planetscale-cli", "planetscale-mcp", "planetscale-insights-mcp"],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      tools: {
        "ui:enumNames": ["PlanetScale CLI", "PlanetScale MCP", "PlanetScale Insights MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    });
  });
});
