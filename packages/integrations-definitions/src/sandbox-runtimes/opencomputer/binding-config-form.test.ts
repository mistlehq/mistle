import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveOpenComputerBindingConfigForm } from "./binding-config-form.js";
import { OpenComputerSandboxRuntimeBindingConfigSchema } from "./schemas.js";

describe("OpenComputer binding config forms", () => {
  it("resolves optional OpenComputer CLI tool selection", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: OpenComputerSandboxRuntimeBindingConfigSchema,
      form: resolveOpenComputerBindingConfigForm,
      context: {
        familyId: "opencomputer",
        variantId: "opencomputer-default",
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
            enum: ["opencomputer-cli"],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      tools: {
        "ui:enumNames": ["OpenComputer CLI"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    });
  });
});
