import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveRenderBindingConfigForm } from "./binding-config-form.js";
import { RenderBindingConfigSchema } from "./binding-config-schema.js";
import { RenderToolIds } from "./tool-ids.js";

describe("render binding config forms", () => {
  it("defaults Render MCP to selected", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: RenderBindingConfigSchema,
      form: resolveRenderBindingConfigForm,
      context: {
        familyId: "render",
        variantId: "render-mcp",
        kind: "connector",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        tools: {
          title: "Tools",
          default: [RenderToolIds.RENDER_MCP],
          items: {
            type: "string",
            enum: [RenderToolIds.RENDER_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      tools: {
        "ui:enumNames": ["Render MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    });
  });
});
