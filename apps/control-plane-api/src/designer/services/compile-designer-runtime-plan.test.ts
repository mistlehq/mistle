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
      organizationId: "org_eval_local_auth",
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
      organizationId: "org_eval_platform_auth",
    });

    const configFile = runtimePlan.runtimeClients
      .find((runtimeClient) => runtimeClient.clientId === "codex-cli")
      ?.setup.files.find((file) => file.fileId === "codex_config");

    expect(configFile?.content).toContain('model_provider = "proxy"');
    expect(configFile?.content).toContain("[model_providers.proxy]");
    expect(configFile?.content).toContain("requires_openai_auth = false");
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
      organizationId: "org_eval_without_mistle_mcp",
    });

    const configFile = runtimePlan.runtimeClients
      .find((runtimeClient) => runtimeClient.clientId === "codex-cli")
      ?.setup.files.find((file) => file.fileId === "codex_config");

    expect(configFile?.content).not.toContain("mistle_mcp");
    expect(configFile?.content).toContain("mistle_docs");
  });
});
