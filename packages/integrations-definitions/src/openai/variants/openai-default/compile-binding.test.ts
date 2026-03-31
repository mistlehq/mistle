import { describe, expect, it } from "vitest";

import { compileOpenAiApiKeyBinding } from "./compile-binding.js";
import { createOpenAiRawBindingCapabilities } from "./model-capabilities.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";

describe("compileOpenAiApiKeyBinding", () => {
  it("is a no-op once agent runtime compilation is runtime-owned", () => {
    const compiled = compileOpenAiApiKeyBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "openai-default",
      target: {
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: OpenAiApiKeyTargetConfigSchema.parse({
          api_base_url: "https://api.openai.com",
          binding_capabilities: createOpenAiRawBindingCapabilities(),
        }),
        secrets: {},
      },
      connection: {
        id: "conn_openai_org_123",
        status: "active",
        config: {
          connection_method: "api-key",
        },
      },
      binding: {
        id: "bind_openai_agent",
        kind: "agent",
        config: {
          runtime: {
            runtimeId: "codex",
            config: {},
          },
          model: {
            defaultModel: "gpt-5.3-codex",
            options: {
              reasoningEffort: "medium",
            },
          },
        },
      },
      refs: {
        sandboxPaths: {
          userHomeDir: "/root",
          workspaceDir: "/root",
          runtimeDataDir: "/var/lib/mistle",
          runtimeArtifactDir: "/var/lib/mistle/artifacts",
          runtimeArtifactBinDir: "/usr/local/bin",
        },
        artifactBinPath: (artifactName) => `/usr/local/bin/${artifactName}`,
      },
    });

    expect(compiled).toEqual({
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [],
    });
  });
});
