import { describe, expect, it } from "vitest";

import { compileOpenAiApiKeyBinding } from "./compile-binding.js";

describe("compileOpenAiApiKeyBinding", () => {
  it("builds expected egress route and codex runtime setup", () => {
    const compiled = compileOpenAiApiKeyBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "openai_default",
      target: {
        familyId: "openai",
        variantId: "openai-api-key",
        enabled: true,
        config: {
          apiBaseUrl: "https://api.openai.com/v1",
        },
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {},
      },
      binding: {
        id: "ibd_123",
        kind: "agent",
        config: {
          runtime: "codex-cli",
          defaultModel: "gpt-5.3-codex",
          reasoningEffort: "medium",
        },
      },
      runtimeContext: {
        sandboxProvider: "docker",
        sandboxdEgressBaseUrl: "http://sandboxd.internal",
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        routeId: "route_ibd_123",
        bindingId: "ibd_123",
        match: {
          hosts: ["api.openai.com"],
          pathPrefixes: ["/v1"],
          methods: ["POST"],
        },
        upstream: {
          baseUrl: "https://api.openai.com/v1",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "icn_123",
          secretType: "api_key",
        },
      },
    ]);

    expect(compiled.runtimeClientSetups).toHaveLength(1);
    expect(compiled.runtimeClientSetups[0]?.env).toEqual({
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_MODEL: "gpt-5.3-codex",
      OPENAI_REASONING_EFFORT: "medium",
    });
    expect(compiled.runtimeClientSetups[0]?.files[0]?.path).toBe("/workspace/.codex/config.toml");
  });

  it("uses target base-url host and path for custom upstreams", () => {
    const compiled = compileOpenAiApiKeyBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "openai_proxy",
      target: {
        familyId: "openai",
        variantId: "openai-api-key",
        enabled: true,
        config: {
          apiBaseUrl: "https://proxy.example.com/openai-v2",
        },
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {},
      },
      binding: {
        id: "ibd_123",
        kind: "agent",
        config: {
          runtime: "codex-cli",
          defaultModel: "gpt-5.3-codex",
          reasoningEffort: "high",
        },
      },
      runtimeContext: {
        sandboxProvider: "docker",
        sandboxdEgressBaseUrl: "http://sandboxd.internal",
      },
    });

    expect(compiled.egressRoutes[0]?.match.hosts).toEqual(["proxy.example.com"]);
    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual(["/openai-v2"]);
  });
});
