import { describe, expect, it } from "vitest";

import { OpenAiApiKeyDefinition } from "./definition.js";
import {
  createOpenAiRawBindingCapabilities,
  createOpenAiRawBindingCapabilitiesByConnectionMethod,
} from "./model-capabilities.js";
import {
  OpenAiApiKeyTargetConfigSchema,
  OpenAiChatGptBaseUrl,
  OpenAiChatGptOriginBaseUrl,
  OpenAiChatGptResponsesApiBaseUrl,
} from "./target-config-schema.js";

describe("OpenAiApiKeyDefinition", () => {
  it("resolves allowed models from the selected connection method capability set", () => {
    if (OpenAiApiKeyDefinition.capabilities === undefined) {
      throw new Error("Expected OpenAI definition capabilities resolver.");
    }

    const defaultCapabilities = createOpenAiRawBindingCapabilities();
    const targetConfig = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com/v1",
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
    });

    const resolvedCapabilities = OpenAiApiKeyDefinition.capabilities.resolveCapabilities({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "openai-default",
      target: {
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: targetConfig,
        secrets: {},
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {
          connection_method: "chatgpt-device-code",
          auth_mode: "chatgpt",
          chatgpt_account_id: "acct_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "agent",
        config: {
          runtime: {
            runtimeId: "codex",
            config: {},
          },
        },
      },
      refs: {
        sandboxPaths: {
          userHomeDir: "/sandbox/home",
          workspaceDir: "/sandbox/home",
          runtimeDataDir: "/sandbox/runtime-data",
          runtimeArtifactDir: "/sandbox/runtime-artifacts",
          runtimeArtifactBinDir: "/sandbox/runtime-artifacts/bin",
        },
        artifactBinPath: (name) => `/sandbox/runtime-artifacts/bin/${name}`,
      },
    });

    expect(resolvedCapabilities.agentProviderAccess?.allowedModels).toEqual(["gpt-5.4"]);
    expect(resolvedCapabilities.agentProviderAccess?.defaultModel).toBe("gpt-5.4");
    expect(resolvedCapabilities.agentProviderAccess?.additionalHeaders).toEqual({
      "ChatGPT-Account-ID": "acct_123",
    });
    expect(resolvedCapabilities.agentProviderAccess?.apiBaseUrl).toBe(OpenAiChatGptOriginBaseUrl);
    expect(resolvedCapabilities.agentProviderAccess?.allowedPathPrefixes).toEqual(["/"]);
    expect(resolvedCapabilities.agentProviderAccess?.providerMetadata).toMatchObject({
      responsesApiBaseUrl: OpenAiChatGptResponsesApiBaseUrl,
      chatgptBaseUrl: OpenAiChatGptBaseUrl,
    });
  });
});
