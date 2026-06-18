import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveE2BBindingConfigForm } from "./binding-config-form.js";
import { E2BSandboxRuntimeBindingConfigSchema } from "./schemas.js";

describe("E2B binding config forms", () => {
  it("resolves optional E2B CLI tool selection", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: E2BSandboxRuntimeBindingConfigSchema,
      form: resolveE2BBindingConfigForm,
      context: {
        familyId: "e2b",
        variantId: "e2b-default",
        kind: "sandbox",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        tools: {
          title: "Tools",
          default: [],
          items: {
            type: "string",
            enum: ["e2b-cli"],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      tools: {
        "ui:enumNames": ["E2B CLI"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    });
  });
});
