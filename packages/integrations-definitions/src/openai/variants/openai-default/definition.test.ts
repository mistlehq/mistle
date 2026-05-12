import { describe, expect, it } from "vitest";

import { OpenAiApiKeyDefinition } from "./definition.js";
import {
  OpenAiApiKeyTargetConfigSchema,
  OpenAiChatGptOriginBaseUrl,
} from "./target-config-schema.js";

describe("OpenAiApiKeyDefinition", () => {
  it("compiles OpenAI API key access into a provider-owned egress route", () => {
    const targetConfig = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com/v1",
    });

    expect(
      OpenAiApiKeyDefinition.compileBinding({
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
            connection_method: "api-key",
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
      }).egressRoutes,
    ).toEqual([
      {
        match: {
          hosts: ["api.openai.com"],
          pathPrefixes: ["/"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://api.openai.com/v1",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: "openai.openai-default.api-key.api-key",
        },
      },
    ]);
  });

  it("compiles ChatGPT subscription access into a provider-owned egress route", () => {
    const targetConfig = OpenAiApiKeyTargetConfigSchema.parse({
      api_base_url: "https://api.openai.com/v1",
    });

    expect(
      OpenAiApiKeyDefinition.compileBinding({
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
      }).egressRoutes,
    ).toEqual([
      {
        match: {
          hosts: ["chatgpt.com"],
          pathPrefixes: ["/"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: OpenAiChatGptOriginBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        additionalHeaders: {
          "ChatGPT-Account-ID": "acct_123",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "oauth2_access_token",
          slotKey: "openai.openai-default.oauth2-authorization-code.access-token",
        },
      },
    ]);
  });
});
