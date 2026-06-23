import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveAutumnBindingConfigForm } from "./binding-config-form.js";
import { AutumnBindingConfigSchema } from "./binding-config-schema.js";
import { AutumnMcpServerIds } from "./mcp-catalog.js";

describe("resolveAutumnBindingConfigForm", () => {
  it("renders Autumn MCP as the default selectable server", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: AutumnBindingConfigSchema,
      form: resolveAutumnBindingConfigForm,
      context: {
        familyId: "autumn",
        variantId: "autumn-mcp",
        kind: "connector",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        mcpServers: {
          title: "Autumn MCP servers",
          default: [AutumnMcpServerIds.AUTUMN],
          items: {
            type: "string",
            enum: [AutumnMcpServerIds.AUTUMN],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      mcpServers: {
        "ui:enumNames": ["Autumn MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
          emptyMessage: "No matching remote MCP servers.",
        },
      },
    });
  });
});
