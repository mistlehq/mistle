import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveJiraBindingConfigForm } from "./binding-config-form.js";
import { JiraBindingConfigSchema } from "./binding-config-schema.js";

describe("jira binding config forms", () => {
  it("resolves optional Jira CLI tool selection", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: JiraBindingConfigSchema,
      form: resolveJiraBindingConfigForm,
      context: {
        familyId: "jira",
        variantId: "jira-default",
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
            enum: ["jira-cli"],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      tools: {
        "ui:enumNames": ["Jira CLI"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    });
  });
});
