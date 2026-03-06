import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { OpenAiConnectionConfigSchema } from "./auth.js";
import {
  OpenAiConnectionConfigForm,
  resolveOpenAiBindingConfigForm,
} from "./binding-config-form.js";
import { OpenAiApiKeyBindingConfigSchema } from "./binding-config-schema.js";
import { createOpenAiRawBindingCapabilities } from "./model-capabilities.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";

describe("openai binding config forms", () => {
  it("resolves binding config choices from target capabilities and connection auth scheme", () => {
    const targetConfig = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com",
      binding_capabilities: createOpenAiRawBindingCapabilities(),
    });
    const connectionConfig = OpenAiConnectionConfigSchema.parse({
      auth_scheme: "api-key",
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
            auth_scheme: "api-key",
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
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
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

  it("declares the OpenAI connection auth scheme form", () => {
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
        auth_scheme: {
          title: "Authentication method",
          default: "api-key",
          oneOf: [
            {
              const: "api-key",
              title: "api-key",
            },
            {
              const: "oauth",
              title: "oauth",
            },
          ],
        },
      },
    });
  });
});
