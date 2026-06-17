import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveTensorlakeBindingConfigForm } from "./binding-config-form.js";
import { TensorlakeSandboxRuntimeBindingConfigSchema } from "./schemas.js";

describe("tensorlake binding config forms", () => {
  it("resolves optional Tensorlake CLI tool selection", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: TensorlakeSandboxRuntimeBindingConfigSchema,
      form: resolveTensorlakeBindingConfigForm,
      context: {
        familyId: "tensorlake",
        variantId: "tensorlake-default",
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
            enum: ["tensorlake-cli"],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      tools: {
        "ui:enumNames": ["Tensorlake CLI"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    });
  });
});
