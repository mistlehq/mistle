import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveSlackBindingConfigForm } from "./binding-config-form.js";
import { SlackBindingConfigSchema } from "./binding-config-schema.js";

describe("slack binding config forms", () => {
  it("resolves optional Slack CLI and MCP tool selections", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: SlackBindingConfigSchema,
      form: resolveSlackBindingConfigForm,
      context: {
        familyId: "slack",
        variantId: "slack-default",
        kind: "connector",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        tools: {
          title: "Tools",
          default: ["slack-cli"],
          items: {
            type: "string",
            enum: ["slack-cli", "slack-mcp"],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      tools: {
        "ui:enumNames": ["Slack CLI", "Slack MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    });
  });
});
