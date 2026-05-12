import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { OpenAiConnectionConfigSchema } from "./auth.js";
import {
  OpenAiConnectionConfigForm,
  resolveOpenAiBindingConfigForm,
} from "./binding-config-form.js";
import { OpenAiApiKeyBindingConfigSchema } from "./binding-config-schema.js";

describe("openai binding config forms", () => {
  it("resolves an empty binding config form", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: OpenAiApiKeyBindingConfigSchema,
      form: resolveOpenAiBindingConfigForm,
      context: {
        familyId: "openai",
        variantId: "openai-default",
        kind: "agent",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {},
    });
    if (resolvedForm.schema === undefined) {
      throw new Error("Expected resolved OpenAI binding config form schema.");
    }
    expect(resolvedForm.schema.properties).not.toHaveProperty("model");
    expect(resolvedForm.uiSchema).toBeUndefined();
  });

  it("declares the OpenAI connection method form", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: OpenAiConnectionConfigSchema,
      form: OpenAiConnectionConfigForm,
      context: {
        familyId: "openai",
        variantId: "openai-default",
        kind: "agent",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        connection_method: {
          default: "api-key",
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      connection_method: {
        "ui:widget": "hidden",
      },
    });
  });
});
