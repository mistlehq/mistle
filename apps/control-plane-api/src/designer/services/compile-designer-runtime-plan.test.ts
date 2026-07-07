import { describe, expect, it } from "vitest";

import { createDesignerRuntimePlan } from "./compile-designer-runtime-plan.js";

describe("createDesignerRuntimePlan", () => {
  it("omits proxied OpenAI provider config when evals use local Codex subscription auth", () => {
    const runtimePlan = createDesignerRuntimePlan({
      codexCliPath: "/usr/local/bin/codex",
      designerSessionId: "dsn_eval_local_auth",
      imageRef: "mistle/codex:eval",
      initialPrompt: "Build a GitHub PR review agent.",
      mistleMcp: {
        enabled: true,
        url: "http://127.0.0.1:4000/mcp",
      },
      openAiProviderMode: "local_subscription",
    });

    const configFile = runtimePlan.runtimeClients
      .find((runtimeClient) => runtimeClient.clientId === "codex-cli")
      ?.setup.files.find((file) => file.fileId === "codex_config");

    expect(configFile?.content).not.toContain("model_provider");
    expect(configFile?.content).not.toContain("model_providers");
    expect(configFile?.content).not.toContain("requires_openai_auth = false");
    expect(configFile?.content).toContain('approval_policy = "never"');
  });

  it("keeps proxied platform OpenAI provider config by default", () => {
    const runtimePlan = createDesignerRuntimePlan({
      codexCliPath: "/usr/local/bin/codex",
      designerSessionId: "dsn_eval_platform_auth",
      imageRef: "mistle/codex:eval",
      initialPrompt: "Build a GitHub PR review agent.",
      mistleMcp: {
        enabled: true,
        url: "http://127.0.0.1:4000/mcp",
      },
    });

    const configFile = runtimePlan.runtimeClients
      .find((runtimeClient) => runtimeClient.clientId === "codex-cli")
      ?.setup.files.find((file) => file.fileId === "codex_config");

    expect(configFile?.content).toContain('model_provider = "proxy"');
    expect(configFile?.content).toContain("[model_providers.proxy]");
    expect(configFile?.content).toContain("requires_openai_auth = false");
  });

  it("adds Langfuse tracing config and a managed egress route when configured", () => {
    const runtimePlan = createDesignerRuntimePlan({
      codexCliPath: "/usr/local/bin/codex",
      designerSessionId: "dsn_eval_langfuse",
      imageRef: "mistle/codex:eval",
      initialPrompt: "Build a GitHub PR review agent.",
      langfuse: {
        enabled: true,
        publicKey: "pk-lf-public",
        baseUrl: "http://host.docker.internal:4318",
        environment: "development",
        tags: ["mistle-designer"],
        metadata: {
          "mistle.organization_id": "org_123",
          "mistle.designer_session_id": "dsn_eval_langfuse",
        },
      },
      mistleMcp: {
        enabled: true,
        url: "http://127.0.0.1:4000/mcp",
      },
    });

    const langfuseRoute = runtimePlan.egressRoutes.find(
      (route) => route.egressRuleId === "egress_rule_designer_langfuse_traces",
    );
    const runtimeClient = runtimePlan.runtimeClients.find(
      (client) => client.clientId === "codex-cli",
    );
    const configFile = runtimeClient?.setup.files.find((file) => file.fileId === "codex_config");
    const requirementsFile = runtimeClient?.setup.files.find(
      (file) => file.fileId === "codex_langfuse_requirements",
    );

    expect(langfuseRoute).toEqual({
      egressRuleId: "egress_rule_designer_langfuse_traces",
      bindingId: "designer-langfuse",
      familyId: "langfuse",
      variantId: "langfuse-otel",
      match: {
        hosts: ["host.docker.internal"],
        pathPrefixes: ["/api/public/otel/v1/traces"],
        methods: ["POST"],
      },
      upstream: {
        baseUrl: "http://host.docker.internal:4318",
      },
      authInjection: {
        type: "basic",
        target: "authorization",
        username: "pk-lf-public",
      },
      additionalHeaders: {
        "x-langfuse-public-key": "pk-lf-public",
      },
      credentialResolver: {
        kind: "platform_langfuse_secret_key",
      },
    });
    expect(runtimeClient?.setup.env).toMatchObject({
      TRACE_TO_LANGFUSE: "true",
      LANGFUSE_CODEX_PUBLIC_KEY: "pk-lf-public",
      LANGFUSE_CODEX_SECRET_KEY: "mistle-managed-egress",
      LANGFUSE_CODEX_BASE_URL: "http://host.docker.internal:4318",
      LANGFUSE_TRACING_ENVIRONMENT: "development",
      LANGFUSE_CODEX_TAGS: "mistle-designer",
    });
    expect(runtimeClient?.setup.env.LANGFUSE_CODEX_METADATA).toBe(
      JSON.stringify({
        "mistle.organization_id": "org_123",
        "mistle.designer_session_id": "dsn_eval_langfuse",
      }),
    );
    expect(configFile?.content).toContain("hooks = true");
    expect(configFile?.content).toContain("plugins = true");
    expect(configFile?.content).toContain('[plugins."tracing@codex-observability-plugin"]');
    expect(requirementsFile?.content).toContain("[[hooks.Stop]]");
    expect(requirementsFile?.content).toContain(
      'command = "node \\"${CODEX_HOME:-$HOME/.codex}/plugins/cache/codex-observability-plugin/tracing/0.1.0/dist/index.mjs\\""',
    );
  });

  it("can compile without the Mistle MCP server for lightweight eval runs", () => {
    const runtimePlan = createDesignerRuntimePlan({
      codexCliPath: "/usr/local/bin/codex",
      designerSessionId: "dsn_eval_without_mistle_mcp",
      imageRef: "mistle/codex:eval",
      initialPrompt: "Build a GitHub PR review agent.",
      mistleMcp: {
        enabled: false,
      },
      openAiProviderMode: "local_subscription",
    });

    const configFile = runtimePlan.runtimeClients
      .find((runtimeClient) => runtimeClient.clientId === "codex-cli")
      ?.setup.files.find((file) => file.fileId === "codex_config");

    expect(configFile?.content).not.toContain("mistle_mcp");
    expect(configFile?.content).toContain("mistle_docs");
  });
});
