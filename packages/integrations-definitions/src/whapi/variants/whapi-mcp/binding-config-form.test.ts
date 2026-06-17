import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { WhapiConnectionConfigSchema } from "./auth.js";
import { WhapiConnectionConfigForm, resolveWhapiBindingConfigForm } from "./binding-config-form.js";
import { WhapiBindingConfigSchema } from "./binding-config-schema.js";
import { WhapiToolIds } from "./tool-ids.js";

describe("whapi binding config forms", () => {
  it("defaults Whapi MCP to selected", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: WhapiBindingConfigSchema,
      form: resolveWhapiBindingConfigForm,
      context: {
        familyId: "whapi",
        variantId: "whapi-mcp",
        kind: "connector",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        tools: {
          title: "Tools",
          default: [WhapiToolIds.WHAPI_MCP],
          items: {
            type: "string",
            enum: [WhapiToolIds.WHAPI_MCP],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toMatchObject({
      tools: {
        "ui:enumNames": ["Whapi MCP"],
        "ui:widget": "checkboxes",
      },
    });
  });

  it("hides the single API key connection method while defaulting it in config", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: WhapiConnectionConfigSchema,
      form: WhapiConnectionConfigForm,
      context: {
        familyId: "whapi",
        variantId: "whapi-mcp",
        kind: "connector",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        connection_method: {
          default: "api-key",
        },
      },
    });
    expect(resolvedForm.uiSchema).toMatchObject({
      connection_method: {
        "ui:widget": "hidden",
      },
    });
  });
});
