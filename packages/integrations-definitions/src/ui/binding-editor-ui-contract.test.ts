import { describe, expect, it } from "vitest";

import {
  buildBindingEditorRenderableFields,
  createDefaultConfigFromBindingEditorVariant,
  parseConfigAgainstBindingEditorVariant,
  resolveBindingEditorVariant,
  type IntegrationBindingEditorUiProjection,
  updateBindingEditorConfigByField,
} from "./binding-editor-ui-contract.js";

const ConnectionScopedProjection: IntegrationBindingEditorUiProjection = {
  bindingEditor: {
    kind: "agent",
    config: {
      mode: "connection-config-key",
      key: "auth_scheme",
      variants: {
        "api-key": {
          fields: [
            {
              type: "literal",
              key: "runtime",
              value: "codex-cli",
            },
            {
              type: "select",
              key: "model",
              label: "Model",
              options: [
                { value: "gpt-5-mini", label: "GPT-5 Mini" },
                { value: "gpt-5", label: "GPT-5" },
              ],
              defaultValue: "gpt-5-mini",
            },
            {
              type: "select",
              key: "reasoning",
              label: "Reasoning",
              options: [
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
              ],
              defaultValue: "medium",
              optionsByFieldValue: {
                fieldKey: "model",
                optionsByValue: {
                  "gpt-5-mini": [{ value: "medium", label: "Medium" }],
                  "gpt-5": [
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                  ],
                },
                defaultValueByValue: {
                  "gpt-5-mini": "medium",
                  "gpt-5": "high",
                },
              },
            },
            {
              type: "string-array",
              key: "hosts",
              label: "Hosts",
              defaultValue: ["api.openai.com"],
              delimiter: ",",
            },
          ],
        },
      },
    },
  },
};

describe("binding-editor-ui-contract helpers", () => {
  it("resolves connection-scoped variant and default config", () => {
    const resolvedVariant = resolveBindingEditorVariant({
      projection: ConnectionScopedProjection,
      connectionConfig: { auth_scheme: "api-key" },
    });
    expect(resolvedVariant.ok).toBe(true);
    if (!resolvedVariant.ok) {
      throw new Error("Expected variant resolution to succeed.");
    }

    const config = createDefaultConfigFromBindingEditorVariant({
      variant: resolvedVariant.variant,
    });

    expect(config).toEqual({
      runtime: "codex-cli",
      model: "gpt-5-mini",
      reasoning: "medium",
      hosts: ["api.openai.com"],
    });
  });

  it("validates config and builds renderable fields", () => {
    const resolvedVariant = resolveBindingEditorVariant({
      projection: ConnectionScopedProjection,
      connectionConfig: { auth_scheme: "api-key" },
    });
    if (!resolvedVariant.ok) {
      throw new Error("Expected variant resolution to succeed.");
    }

    const parsed = parseConfigAgainstBindingEditorVariant({
      variant: resolvedVariant.variant,
      config: {
        runtime: "codex-cli",
        model: "gpt-5",
        reasoning: "high",
        hosts: ["api.openai.com", "proxy.example.com"],
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected config parse to succeed.");
    }

    const fields = buildBindingEditorRenderableFields({
      variant: resolvedVariant.variant,
      value: parsed.value,
    });

    expect(fields).toEqual([
      {
        type: "select",
        key: "model",
        label: "Model",
        value: "gpt-5",
        options: [
          { value: "gpt-5-mini", label: "GPT-5 Mini" },
          { value: "gpt-5", label: "GPT-5" },
        ],
      },
      {
        type: "select",
        key: "reasoning",
        label: "Reasoning",
        value: "high",
        options: [
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ],
      },
      {
        type: "string-array",
        key: "hosts",
        label: "Hosts",
        value: ["api.openai.com", "proxy.example.com"],
        delimiter: ",",
      },
    ]);
  });

  it("updates dependent select values when parent field changes", () => {
    const resolvedVariant = resolveBindingEditorVariant({
      projection: ConnectionScopedProjection,
      connectionConfig: { auth_scheme: "api-key" },
    });
    if (!resolvedVariant.ok) {
      throw new Error("Expected variant resolution to succeed.");
    }

    const nextConfig = updateBindingEditorConfigByField({
      variant: resolvedVariant.variant,
      currentConfig: {
        runtime: "codex-cli",
        model: "gpt-5",
        reasoning: "high",
        hosts: ["api.openai.com"],
      },
      fieldKey: "model",
      nextValue: "gpt-5-mini",
    });

    expect(nextConfig).toEqual({
      runtime: "codex-cli",
      model: "gpt-5-mini",
      reasoning: "medium",
      hosts: ["api.openai.com"],
    });
  });
});
