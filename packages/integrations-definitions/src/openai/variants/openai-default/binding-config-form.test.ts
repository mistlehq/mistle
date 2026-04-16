import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { createStackedFieldUiOptions } from "../../../forms/ui-options.js";
import { OpenAiConnectionConfigSchema } from "./auth.js";
import {
  OpenAiConnectionConfigForm,
  resolveOpenAiBindingConfigForm,
} from "./binding-config-form.js";
import { OpenAiApiKeyBindingConfigSchema } from "./binding-config-schema.js";
import {
  createOpenAiRawBindingCapabilities,
  createOpenAiRawBindingCapabilitiesByConnectionMethod,
} from "./model-capabilities.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";

describe("openai binding config forms", () => {
  it("resolves binding config choices from target capabilities", () => {
    const targetConfig = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com",
      binding_capabilities_by_connection_method:
        createOpenAiRawBindingCapabilitiesByConnectionMethod(),
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
            binding_capabilities_by_connection_method:
              createOpenAiRawBindingCapabilitiesByConnectionMethod(),
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
          model: {
            defaultModel: "gpt-5.1-codex-mini",
          },
        },
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        runtime: {
          default: {
            runtimeId: "codex",
            config: {},
          },
          properties: {
            runtimeId: {
              const: "codex",
              default: "codex",
            },
            config: {
              default: {},
            },
          },
        },
        model: {
          default: {
            defaultModel: "gpt-5.1-codex-mini",
            options: {
              reasoningEffort: "medium",
            },
          },
          properties: {
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
            options: {
              properties: {
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
                  title: "Agent Instructions",
                  description: "Appended to the developer message.",
                },
              },
            },
          },
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      runtime: {
        runtimeId: {
          "ui:widget": "hidden",
        },
        config: {
          "ui:widget": "hidden",
        },
      },
      model: {
        defaultModel: {
          "ui:widget": "SelectWidget",
          "ui:options": {
            fitContent: true,
          },
        },
        options: {
          reasoningEffort: {
            "ui:widget": "SelectWidget",
          },
          additionalInstructions: {
            "ui:widget": "TextareaWidget",
            "ui:options": createStackedFieldUiOptions({
              rows: 8,
            }),
          },
        },
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

  it("requires connection config context to resolve the OpenAI binding form", () => {
    expect(() =>
      resolveIntegrationForm({
        schema: OpenAiApiKeyBindingConfigSchema,
        form: resolveOpenAiBindingConfigForm,
        context: {
          familyId: "openai",
          variantId: "openai-default",
          kind: "agent",
          target: {
            rawConfig: {
              api_base_url: "https://api.openai.com",
              binding_capabilities_by_connection_method:
                createOpenAiRawBindingCapabilitiesByConnectionMethod(),
            },
            config: OpenAiApiKeyTargetConfigSchema.parse({
              api_base_url: "https://api.openai.com",
              binding_capabilities_by_connection_method:
                createOpenAiRawBindingCapabilitiesByConnectionMethod(),
            }),
          },
        },
      }),
    ).toThrow(/requires connection config context/);
  });

  it("resolves binding config choices from the selected chatgpt-device-code capability set", () => {
    const defaultCapabilities = createOpenAiRawBindingCapabilities();
    const rawTargetConfig = {
      api_base_url: "https://api.openai.com",
      binding_capabilities_by_connection_method: {
        ...createOpenAiRawBindingCapabilitiesByConnectionMethod(),
        "chatgpt-device-code": {
          ...defaultCapabilities,
          models: ["gpt-5.4"],
          allowed_reasoning_by_model: {
            ...defaultCapabilities.allowed_reasoning_by_model,
            "gpt-5.4": ["high"],
          },
          default_reasoning_by_model: {
            ...defaultCapabilities.default_reasoning_by_model,
            "gpt-5.4": "high",
          },
        },
      },
    };

    const resolvedForm = resolveIntegrationForm({
      schema: OpenAiApiKeyBindingConfigSchema,
      form: resolveOpenAiBindingConfigForm,
      context: {
        familyId: "openai",
        variantId: "openai-default",
        kind: "agent",
        target: {
          rawConfig: rawTargetConfig,
          config: OpenAiApiKeyTargetConfigSchema.parse(rawTargetConfig),
        },
        connection: {
          rawConfig: {
            connection_method: "chatgpt-device-code",
            auth_mode: "chatgpt",
            chatgpt_account_id: "acct_123",
          },
          config: OpenAiConnectionConfigSchema.parse({
            connection_method: "chatgpt-device-code",
            auth_mode: "chatgpt",
            chatgpt_account_id: "acct_123",
          }),
        },
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        model: {
          default: {
            defaultModel: "gpt-5.4",
            options: {
              reasoningEffort: "high",
            },
          },
          properties: {
            defaultModel: {
              oneOf: [
                {
                  const: "gpt-5.4",
                  title: "gpt-5.4",
                },
              ],
            },
            options: {
              properties: {
                reasoningEffort: {
                  oneOf: [
                    {
                      const: "high",
                      title: "High",
                    },
                  ],
                  default: "high",
                },
              },
            },
          },
        },
      },
    });
  });
});
