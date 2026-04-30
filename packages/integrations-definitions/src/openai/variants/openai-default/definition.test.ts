import { describe, expect, it } from "vitest";

import { OpenAiApiKeyDefinition } from "./definition.js";
import {
  OpenAiApiKeyTargetConfigSchema,
  OpenAiChatGptBaseUrl,
  OpenAiChatGptOriginBaseUrl,
  OpenAiChatGptResponsesApiBaseUrl,
} from "./target-config-schema.js";

describe("OpenAiApiKeyDefinition", () => {
  it("resolves ChatGPT subscription provider access from connection method", () => {
    if (OpenAiApiKeyDefinition.capabilities === undefined) {
      throw new Error("Expected OpenAI definition capabilities resolver.");
    }

    const targetConfig = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com/v1",
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
