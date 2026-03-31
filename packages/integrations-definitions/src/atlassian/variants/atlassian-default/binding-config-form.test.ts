import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveAtlassianBindingConfigForm } from "./binding-config-form.js";
import { AtlassianBindingConfigSchema } from "./binding-config-schema.js";

describe("atlassian binding config forms", () => {
  it("resolves optional Jira CLI tool selection", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: AtlassianBindingConfigSchema,
      form: resolveAtlassianBindingConfigForm,
      context: {
        familyId: "atlassian",
        variantId: "atlassian-default",
        kind: "connector",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        tools: {
          title: "Tools",
          default: [],
          items: {
            oneOf: [
              {
                const: "jira-cli",
                title: "Jira CLI (jira)",
              },
            ],
          },
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      tools: {
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    });
  });
});
