import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { createStackedFieldUiOptions } from "../../../forms/ui-options.js";
import { OpenAiConnectionConfigSchema } from "./auth.js";
import {
  OpenAiConnectionConfigForm,
  resolveOpenAiBindingConfigForm,
} from "./binding-config-form.js";
import { OpenAiApiKeyBindingConfigSchema } from "./binding-config-schema.js";
import { createOpenAiRawBindingCapabilities } from "./model-capabilities.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";

describe("openai binding config forms", () => {
  it("resolves binding config choices from target capabilities", () => {
    const targetConfig = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com",
      binding_capabilities: createOpenAiRawBindingCapabilities(),
    });
    const connectionConfig = OpenAiConnectionConfigSchema.parse({
      connection_method: "api-key",
    });

    const resolvedForm = resolveIntegrationForm({
      schema: OpenAiApiKeyBindingConfigSchema,
      form: resolveOpenAiBindingConfigForm,
      context: {
        familyId: "openai",
        variantId: "openai-default",
        kind: "agent",
        target: {
          rawConfig: {
            api_base_url: "https://api.openai.com",
            binding_capabilities: createOpenAiRawBindingCapabilities(),
          },
          config: targetConfig,
        },
        connection: {
          rawConfig: {
            connection_method: "api-key",
          },
          config: connectionConfig,
        },
        currentValue: {
          defaultModel: "gpt-5.1-codex-mini",
        },
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        runtime: {
          const: "codex-cli",
          default: "codex-cli",
        },
        defaultModel: {
          title: "Default model",
          default: "gpt-5.1-codex-mini",
          oneOf: expect.arrayContaining([
            {
              const: "gpt-5.4",
              title: "gpt-5.4",
            },
            {
              const: "gpt-5.4-mini",
              title: "gpt-5.4-mini",
            },
          ]),
        },
        reasoningEffort: {
          title: "Reasoning effort",
          default: "medium",
          oneOf: [
            {
              const: "medium",
              title: "Medium",
            },
            {
              const: "high",
              title: "High",
            },
          ],
        },
        additionalInstructions: {
          title: "Additional instructions",
          description: "Added to the runtime's built-in agent instructions.",
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      additionalInstructions: {
        "ui:widget": "TextareaWidget",
        "ui:options": createStackedFieldUiOptions({
          rows: 8,
        }),
      },
      defaultModel: {
        "ui:widget": "SelectWidget",
        "ui:options": {
          fitContent: true,
        },
      },
      reasoningEffort: {
        "ui:widget": "SelectWidget",
      },
      runtime: {
        "ui:widget": "hidden",
      },
    });
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
