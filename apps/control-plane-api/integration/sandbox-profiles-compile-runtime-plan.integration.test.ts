import {
  IntegrationBindingKinds,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
import {
  IntegrationConnectionMethodIds,
  type RuntimeArtifactInstallStep,
} from "@mistle/integrations-core";
import {
  DatadogToolIds,
  createOpenAiRawBindingCapabilitiesByConnectionMethod,
  OpenAiChatGptBaseUrl,
  OpenAiChatGptOriginBaseUrl,
  OpenAiChatGptResponsesApiBaseUrl,
  OpenAiConnectionMethodIds,
} from "@mistle/integrations-definitions";
import { describe, expect } from "vitest";

import {
  CodexAppServerListenUrl,
  CodexProxyListenUrl,
} from "../../../packages/integrations-definitions/src/agent-runtimes/codex/app-server.js";
import { compileProfileVersionRuntimePlan } from "../src/sandbox-profiles/compile-profile-version-runtime-plan.js";
import {
  SandboxProfilesCompileError,
  SandboxProfilesCompileErrorCodes,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../src/sandbox-profiles/errors.js";
import { it } from "./test-context.js";

const GitHubCliTokenPattern = /^ghp_[A-Za-z0-9]{36}$/;

function expectArtifactInstallStep(
  step: RuntimeArtifactInstallStep | undefined,
): RuntimeArtifactInstallStep {
  if (step === undefined) {
    throw new Error("Expected artifact install step.");
  }

  return step;
}

function expectExecInstallStep(
  step: RuntimeArtifactInstallStep | undefined,
): Extract<RuntimeArtifactInstallStep, { op: "exec" }> {
  const installStep = expectArtifactInstallStep(step);
  if (installStep.op !== "exec") {
    throw new Error(`Expected exec artifact install step, received ${installStep.op}.`);
  }

  return installStep;
}

function expectGitHubReleaseInstallStep(
  step: RuntimeArtifactInstallStep | undefined,
): Extract<RuntimeArtifactInstallStep, { op: "github_release_install" }> {
  const installStep = expectArtifactInstallStep(step);
  if (installStep.op !== "github_release_install") {
    throw new Error(`Expected github_release_install artifact step, received ${installStep.op}.`);
  }

  return installStep;
}

describe("sandbox profile compile runtime plan integration", () => {
  it("compiles runtime plan from version bindings, connections, and targets", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-success@example.com",
    });
    const targetKey = "openai-default-compile-runtime-plan";

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_success",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Success Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_success",
      version: 1,
    });
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey,
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com/v1",
          binding_capabilities_by_connection_method:
            createOpenAiRawBindingCapabilitiesByConnectionMethod(),
        },
      })
      .onConflictDoNothing();
    await fixture.db.insert(integrationConnections).values({
      id: "icn_compile_success",
      organizationId: authenticatedSession.organizationId,
      targetKey,
      displayName: "Compile Success Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_compile_success",
      sandboxProfileId: "sbp_compile_success",
      sandboxProfileVersion: 1,
      connectionId: "icn_compile_success",
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: {
          runtimeId: "codex",
          config: {},
        },
        model: {
          defaultModel: "gpt-5.3-codex",
          options: {
            reasoningEffort: "medium",
            additionalInstructions: "Prefer concise answers.\nAlways explain tradeoffs.",
          },
        },
      },
    });

    const runtimePlan = await compileProfileVersionRuntimePlan(
      {
        db: fixture.db,
        integrationsConfig: fixture.config.integrations,
      },
      {
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_compile_success",
        profileVersion: 1,
        image: {
          source: "base",
          imageRef: "mistle/sandbox-base:dev",
        },
      },
    );

    expect(runtimePlan.sandboxProfileId).toBe("sbp_compile_success");
    expect(runtimePlan.version).toBe(1);
    expect(runtimePlan.egressRoutes).toHaveLength(1);
    expect(runtimePlan.artifacts).toHaveLength(1);
    expect(runtimePlan.artifacts[0]?.artifactKey).toBe("codex-cli");
    expect(runtimePlan.artifacts[0]?.name).toBe("Codex CLI");

    const installCommand = expectGitHubReleaseInstallStep(
      runtimePlan.artifacts[0]?.lifecycle.install[0],
    );
    expect(installCommand).toEqual({
      op: "github_release_install",
      repository: "openai/codex",
      release: {
        kind: "tag",
        match: "exact",
        tag: "rust-v0.120.0",
      },
      asset: {
        kind: "by_arch",
        x86_64: {
          fileName: "codex-x86_64-unknown-linux-musl.tar.gz",
          format: "tar.gz",
          extractedPath: "codex-x86_64-unknown-linux-musl",
        },
        aarch64: {
          fileName: "codex-aarch64-unknown-linux-musl.tar.gz",
          format: "tar.gz",
          extractedPath: "codex-aarch64-unknown-linux-musl",
        },
      },
      installPath: "/usr/local/bin/codex",
      timeoutMs: 120_000,
    });
    expect(runtimePlan.runtimeClients).toHaveLength(1);
    expect(runtimePlan.runtimeClients[0]).toMatchObject({
      clientId: "codex-cli",
      setup: {
        env: {
          OPENAI_MODEL: "gpt-5.3-codex",
          OPENAI_REASONING_EFFORT: "medium",
        },
        files: [
          {
            fileId: "codex_config",
            path: "/etc/codex/config.toml",
            mode: 384,
            writeMode: "if-absent",
          },
        ],
      },
      processes: [
        {
          processKey: "codex-app-server",
          command: {
            args: ["/usr/local/bin/codex", "app-server", "--listen", CodexAppServerListenUrl],
          },
          readiness: {
            type: "ws",
            url: CodexAppServerListenUrl,
            timeoutMs: 5_000,
          },
          stop: {
            signal: "sigterm",
            timeoutMs: 10_000,
            gracePeriodMs: 2_000,
          },
        },
      ],
      endpoints: [
        {
          endpointKey: "app-server",
          processKey: "codex-app-server",
          transport: {
            type: "ws",
            url: CodexProxyListenUrl,
          },
          connectionMode: "dedicated",
        },
      ],
    });
    const configContent = runtimePlan.runtimeClients[0]?.setup.files[0]?.content;
    expect(configContent).toContain('model = "gpt-5.3-codex"');
    expect(configContent).toContain('model_provider = "proxy"');
    expect(configContent).toContain('model_reasoning_effort = "medium"');
    expect(configContent).toContain('approval_policy = "never"');
    expect(configContent).toContain('sandbox_mode = "danger-full-access"');
    expect(configContent).toContain("developer_instructions");
    expect(configContent).toContain("Mistle-managed sandbox context:");
    expect(configContent).toContain("managed outbound proxy");
    expect(configContent).toContain("User-provided additional instructions:");
    expect(configContent).toContain("Prefer concise answers.");
    expect(configContent).toContain("Always explain tradeoffs.");
    expect(configContent?.indexOf("Mistle-managed sandbox context:")).toBeLessThan(
      configContent?.indexOf("User-provided additional instructions:") ?? 0,
    );
    expect(configContent?.indexOf("User-provided additional instructions:")).toBeLessThan(
      configContent?.indexOf("Prefer concise answers.") ?? 0,
    );
    expect(configContent).toContain("[model_providers.proxy]");
    expect(configContent).toContain('name = "OpenAI"');
    expect(configContent).toContain('base_url = "https://api.openai.com/v1"');
    expect(configContent).toContain('wire_api = "responses"');
    expect(configContent).toContain("requires_openai_auth = false");
    expect(configContent).toContain("supports_websockets = false");
    expect(configContent).toContain('[projects."/"]');
    expect(configContent).toContain('trust_level = "trusted"');
    expect(configContent).toContain("[features]");
    expect(configContent).toContain("apps = false");
    expect(configContent).toContain("plugins = false");
    expect(configContent).toContain("tool_search = true");
  });

  it("uses the ChatGPT responses base URL for chatgpt-device-code connections", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-chatgpt-base-url@example.com",
    });
    const targetKey = "openai-default-compile-runtime-plan-chatgpt";

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_chatgpt_base_url",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile ChatGPT Base URL Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_chatgpt_base_url",
      version: 1,
    });
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey,
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com/v1",
          binding_capabilities_by_connection_method:
            createOpenAiRawBindingCapabilitiesByConnectionMethod(),
        },
      })
      .onConflictDoNothing();
    await fixture.db.insert(integrationConnections).values({
      id: "icn_compile_chatgpt_base_url",
      organizationId: authenticatedSession.organizationId,
      targetKey,
      displayName: "Compile ChatGPT Base URL Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE,
        auth_mode: "chatgpt",
        chatgpt_account_id: "acct_123",
        chatgpt_plan_type: "pro",
      },
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_compile_chatgpt_base_url",
      sandboxProfileId: "sbp_compile_chatgpt_base_url",
      sandboxProfileVersion: 1,
      connectionId: "icn_compile_chatgpt_base_url",
      kind: IntegrationBindingKinds.AGENT,
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
    });

    const runtimePlan = await compileProfileVersionRuntimePlan(
      {
        db: fixture.db,
        integrationsConfig: fixture.config.integrations,
      },
      {
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_compile_chatgpt_base_url",
        profileVersion: 1,
        image: {
          source: "base",
          imageRef: "mistle/sandbox-base:dev",
        },
      },
    );

    expect(runtimePlan.egressRoutes[0]?.upstream.baseUrl).toBe(OpenAiChatGptOriginBaseUrl);
    expect(runtimePlan.egressRoutes[0]?.match.pathPrefixes).toEqual(["/"]);
    expect(runtimePlan.egressRoutes[0]?.additionalHeaders).toEqual({
      "ChatGPT-Account-ID": "acct_123",
    });

    const configContent = runtimePlan.runtimeClients[0]?.setup.files[0]?.content;
    expect(configContent).toContain(`base_url = "${OpenAiChatGptResponsesApiBaseUrl}"`);
    expect(configContent).toContain(`chatgpt_base_url = "${OpenAiChatGptBaseUrl}"`);
    expect(configContent).toContain("[features]");
    expect(configContent).toContain("apps = false");
    expect(configContent).toContain("plugins = false");
    expect(configContent).toContain("tool_search = true");
  });

  it("omits optional github and jira cli artifacts when bindings do not select tools", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-no-optional-tools@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_optional_tools_none",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Optional Tools None Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_optional_tools_none",
      version: 1,
    });
    await fixture.db
      .insert(integrationTargets)
      .values([
        {
          targetKey: "github-cloud-compile-no-tools",
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            api_base_url: "https://api.github.com",
            web_base_url: "https://github.com",
          },
        },
        {
          targetKey: "jira-default-compile-no-tools",
          familyId: "jira",
          variantId: "jira-default",
          enabled: true,
          config: {},
        },
      ])
      .onConflictDoNothing();
    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_compile_no_tools_github",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-cloud-compile-no-tools",
        displayName: "Compile No Tools GitHub Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
      {
        id: "icn_compile_no_tools_jira",
        organizationId: authenticatedSession.organizationId,
        targetKey: "jira-default-compile-no-tools",
        displayName: "Compile No Tools Jira Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: "jira-personal-api-token",
          site_url: "https://mistle.atlassian.net",
          email: "user@example.com",
        },
      },
    ]);
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      {
        id: "ibd_compile_no_tools_github",
        sandboxProfileId: "sbp_compile_optional_tools_none",
        sandboxProfileVersion: 1,
        connectionId: "icn_compile_no_tools_github",
        kind: IntegrationBindingKinds.GIT,
        config: {
          repositories: ["mistlehq/mistle"],
          tools: [],
        },
      },
      {
        id: "ibd_compile_no_tools_jira",
        sandboxProfileId: "sbp_compile_optional_tools_none",
        sandboxProfileVersion: 1,
        connectionId: "icn_compile_no_tools_jira",
        kind: IntegrationBindingKinds.CONNECTOR,
        config: {
          tools: [],
        },
      },
    ]);

    const runtimePlan = await compileProfileVersionRuntimePlan(
      {
        db: fixture.db,
        integrationsConfig: fixture.config.integrations,
      },
      {
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_compile_optional_tools_none",
        profileVersion: 1,
        image: {
          source: "base",
          imageRef: "mistle/sandbox-base:dev",
        },
      },
    );

    expect(runtimePlan.artifacts).toEqual([]);
  });

  it("installs selected github, jira, and slack cli artifacts once each in the compiled runtime plan", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-selected-tools@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_selected_tools",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Selected Tools Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_selected_tools",
      version: 1,
    });
    await fixture.db
      .insert(integrationTargets)
      .values([
        {
          targetKey: "github-cloud-compile-selected-tools",
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            api_base_url: "https://api.github.com",
            web_base_url: "https://github.com",
          },
        },
        {
          targetKey: "jira-default-compile-selected-tools",
          familyId: "jira",
          variantId: "jira-default",
          enabled: true,
          config: {},
        },
        {
          targetKey: "slack-default-compile-selected-tools",
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            api_base_url: "https://slack.com/api",
          },
        },
      ])
      .onConflictDoNothing();
    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_compile_selected_tools_github",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-cloud-compile-selected-tools",
        displayName: "Compile Selected Tools GitHub Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
      {
        id: "icn_compile_selected_tools_jira_a",
        organizationId: authenticatedSession.organizationId,
        targetKey: "jira-default-compile-selected-tools",
        displayName: "Compile Selected Tools Jira Connection A",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: "jira-personal-api-token",
          site_url: "https://mistle.atlassian.net",
          email: "user@example.com",
        },
      },
      {
        id: "icn_compile_selected_tools_jira_b",
        organizationId: authenticatedSession.organizationId,
        targetKey: "jira-default-compile-selected-tools",
        displayName: "Compile Selected Tools Jira Connection B",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: "jira-personal-api-token",
          site_url: "https://mistle-dev.atlassian.net",
          email: "user+dev@example.com",
        },
      },
      {
        id: "icn_compile_selected_tools_slack",
        organizationId: authenticatedSession.organizationId,
        targetKey: "slack-default-compile-selected-tools",
        displayName: "Compile Selected Tools Slack Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: "slack-bot-token",
        },
      },
    ]);
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      {
        id: "ibd_compile_selected_tools_github",
        sandboxProfileId: "sbp_compile_selected_tools",
        sandboxProfileVersion: 1,
        connectionId: "icn_compile_selected_tools_github",
        kind: IntegrationBindingKinds.GIT,
        config: {
          repositories: ["mistlehq/mistle"],
          tools: ["github-cli"],
        },
      },
      {
        id: "ibd_compile_selected_tools_jira_a",
        sandboxProfileId: "sbp_compile_selected_tools",
        sandboxProfileVersion: 1,
        connectionId: "icn_compile_selected_tools_jira_a",
        kind: IntegrationBindingKinds.CONNECTOR,
        config: {
          tools: ["jira-cli"],
        },
      },
      {
        id: "ibd_compile_selected_tools_jira_b",
        sandboxProfileId: "sbp_compile_selected_tools",
        sandboxProfileVersion: 1,
        connectionId: "icn_compile_selected_tools_jira_b",
        kind: IntegrationBindingKinds.CONNECTOR,
        config: {
          tools: ["jira-cli"],
        },
      },
      {
        id: "ibd_compile_selected_tools_slack",
        sandboxProfileId: "sbp_compile_selected_tools",
        sandboxProfileVersion: 1,
        connectionId: "icn_compile_selected_tools_slack",
        kind: IntegrationBindingKinds.CONNECTOR,
        config: {
          tools: ["slack-cli"],
        },
      },
    ]);

    const runtimePlan = await compileProfileVersionRuntimePlan(
      {
        db: fixture.db,
        integrationsConfig: fixture.config.integrations,
      },
      {
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_compile_selected_tools",
        profileVersion: 1,
        image: {
          source: "base",
          imageRef: "mistle/sandbox-base:dev",
        },
      },
    );

    expect(runtimePlan.artifacts).toHaveLength(3);
    expect(runtimePlan.artifacts.map((artifact) => artifact.artifactKey)).toEqual([
      "gh-cli",
      "jira-cli",
      "slack-cli",
    ]);
    expect(runtimePlan.artifacts[0]?.env).toEqual({
      GH_TOKEN: expect.stringMatching(GitHubCliTokenPattern),
    });
    const ghInstallCommand = expectExecInstallStep(runtimePlan.artifacts[0]?.lifecycle.install[0]);
    expect(ghInstallCommand.command.args.slice(0, 2)).toEqual(["sh", "-euc"]);
    expect(ghInstallCommand.command.timeoutMs).toBe(120_000);
    expect(ghInstallCommand.command.args[2]).toContain(
      "https://github.com/cli/cli/releases/latest",
    );

    const jiraInstallCommand = expectGitHubReleaseInstallStep(
      runtimePlan.artifacts[1]?.lifecycle.install[0],
    );
    expect(runtimePlan.artifacts[1]?.env).toEqual({
      JIRA_BASE_URL: "https://mistle.atlassian.net",
    });
    expect(jiraInstallCommand).toEqual({
      op: "github_release_install",
      repository: "mistlehq/tools",
      release: {
        kind: "tag",
        match: "latest_matching_prefix",
        prefix: "jira/",
      },
      asset: {
        kind: "exact",
        fileName: "jira-linux-amd64",
        format: "binary",
      },
      installPath: "/usr/local/bin/jira",
      timeoutMs: 120_000,
    });

    const slackInstallCommand = expectGitHubReleaseInstallStep(
      runtimePlan.artifacts[2]?.lifecycle.install[0],
    );
    expect(runtimePlan.artifacts[2]?.env).toEqual({
      SLACK_BASE_URL: "https://slack.com/api",
    });
    expect(slackInstallCommand).toEqual({
      op: "github_release_install",
      repository: "mistlehq/tools",
      release: {
        kind: "tag",
        match: "latest_matching_prefix",
        prefix: "slack/",
      },
      asset: {
        kind: "exact",
        fileName: "slack-linux-amd64",
        format: "binary",
      },
      installPath: "/usr/local/bin/slack",
      timeoutMs: 120_000,
    });
  });

  it("includes Linear API egress without MCP config when the binding does not select Linear MCP", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-linear-api-only@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_linear_api_only",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Linear API Only Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_linear_api_only",
      version: 1,
    });
    await fixture.db
      .insert(integrationTargets)
      .values([
        {
          targetKey: "openai-default-compile-linear-api-only",
          familyId: "openai",
          variantId: "openai-default",
          enabled: true,
          config: {
            api_base_url: "https://api.openai.com/v1",
            binding_capabilities_by_connection_method:
              createOpenAiRawBindingCapabilitiesByConnectionMethod(),
          },
        },
        {
          targetKey: "linear-default-compile-linear-api-only",
          familyId: "linear",
          variantId: "linear-default",
          enabled: true,
          config: {},
        },
      ])
      .onConflictDoNothing();
    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_compile_linear_api_only_openai",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-default-compile-linear-api-only",
        displayName: "Compile Linear API Only OpenAI Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
      {
        id: "icn_compile_linear_api_only_linear",
        organizationId: authenticatedSession.organizationId,
        targetKey: "linear-default-compile-linear-api-only",
        displayName: "Compile Linear API Only Linear Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
    ]);
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      {
        id: "ibd_compile_linear_api_only_openai",
        sandboxProfileId: "sbp_compile_linear_api_only",
        sandboxProfileVersion: 1,
        connectionId: "icn_compile_linear_api_only_openai",
        kind: IntegrationBindingKinds.AGENT,
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
      {
        id: "ibd_compile_linear_api_only_linear",
        sandboxProfileId: "sbp_compile_linear_api_only",
        sandboxProfileVersion: 1,
        connectionId: "icn_compile_linear_api_only_linear",
        kind: IntegrationBindingKinds.CONNECTOR,
        config: {
          tools: [],
        },
      },
    ]);

    const runtimePlan = await compileProfileVersionRuntimePlan(
      {
        db: fixture.db,
        integrationsConfig: fixture.config.integrations,
      },
      {
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_compile_linear_api_only",
        profileVersion: 1,
        image: {
          source: "base",
          imageRef: "mistle/sandbox-base:dev",
        },
      },
    );

    expect(
      runtimePlan.egressRoutes.some(
        (route) =>
          route.upstream.baseUrl === "https://api.linear.app" &&
          route.match.hosts.includes("api.linear.app") &&
          route.match.pathPrefixes?.includes("/graphql") === true,
      ),
    ).toBe(true);
    expect(
      runtimePlan.egressRoutes.some((route) => route.match.hosts.includes("mcp.linear.app")),
    ).toBe(false);
    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).not.toContain(
      "[mcp_servers.linear]",
    );
  });

  it("includes Linear MCP config and egress when the binding selects Linear MCP", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-linear-mcp@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_linear_mcp",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Linear MCP Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_linear_mcp",
      version: 1,
    });
    await fixture.db
      .insert(integrationTargets)
      .values([
        {
          targetKey: "openai-default-compile-linear-mcp",
          familyId: "openai",
          variantId: "openai-default",
          enabled: true,
          config: {
            api_base_url: "https://api.openai.com/v1",
            binding_capabilities_by_connection_method:
              createOpenAiRawBindingCapabilitiesByConnectionMethod(),
          },
        },
        {
          targetKey: "linear-default-compile-linear-mcp",
          familyId: "linear",
          variantId: "linear-default",
          enabled: true,
          config: {},
        },
      ])
      .onConflictDoNothing();
    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_compile_linear_mcp_openai",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-default-compile-linear-mcp",
        displayName: "Compile Linear MCP OpenAI Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
      {
        id: "icn_compile_linear_mcp_linear",
        organizationId: authenticatedSession.organizationId,
        targetKey: "linear-default-compile-linear-mcp",
        displayName: "Compile Linear MCP Linear Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
    ]);
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      {
        id: "ibd_compile_linear_mcp_openai",
        sandboxProfileId: "sbp_compile_linear_mcp",
        sandboxProfileVersion: 1,
        connectionId: "icn_compile_linear_mcp_openai",
        kind: IntegrationBindingKinds.AGENT,
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
      {
        id: "ibd_compile_linear_mcp_linear",
        sandboxProfileId: "sbp_compile_linear_mcp",
        sandboxProfileVersion: 1,
        connectionId: "icn_compile_linear_mcp_linear",
        kind: IntegrationBindingKinds.CONNECTOR,
        config: {
          tools: ["linear-mcp"],
        },
      },
    ]);

    const runtimePlan = await compileProfileVersionRuntimePlan(
      {
        db: fixture.db,
        integrationsConfig: fixture.config.integrations,
      },
      {
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_compile_linear_mcp",
        profileVersion: 1,
        image: {
          source: "base",
          imageRef: "mistle/sandbox-base:dev",
        },
      },
    );

    expect(
      runtimePlan.egressRoutes.some(
        (route) =>
          route.upstream.baseUrl === "https://api.linear.app" &&
          route.match.hosts.includes("api.linear.app") &&
          route.match.pathPrefixes?.includes("/graphql") === true,
      ),
    ).toBe(true);
    expect(
      runtimePlan.egressRoutes.some((route) => route.match.hosts.includes("mcp.linear.app")),
    ).toBe(true);
    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain(
      "[mcp_servers.linear]",
    );
    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain(
      'url = "https://mcp.linear.app/mcp"',
    );
  });

  it("includes Datadog MCP config and egress with credential-backed application headers", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-datadog-mcp@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_datadog_mcp",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Datadog MCP Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_datadog_mcp",
      version: 1,
    });
    await fixture.db
      .insert(integrationTargets)
      .values([
        {
          targetKey: "openai-default-compile-datadog-mcp",
          familyId: "openai",
          variantId: "openai-default",
          enabled: true,
          config: {
            api_base_url: "https://api.openai.com/v1",
            binding_capabilities_by_connection_method:
              createOpenAiRawBindingCapabilitiesByConnectionMethod(),
          },
        },
        {
          targetKey: "datadog-default-compile-datadog-mcp",
          familyId: "datadog",
          variantId: "datadog-default",
          enabled: true,
          config: {},
        },
      ])
      .onConflictDoNothing();
    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_compile_datadog_mcp_openai",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-default-compile-datadog-mcp",
        displayName: "Compile Datadog MCP OpenAI Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
      {
        id: "icn_compile_datadog_mcp_datadog",
        organizationId: authenticatedSession.organizationId,
        targetKey: "datadog-default-compile-datadog-mcp",
        displayName: "Compile Datadog MCP Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
    ]);
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      {
        id: "ibd_compile_datadog_mcp_openai",
        sandboxProfileId: "sbp_compile_datadog_mcp",
        sandboxProfileVersion: 1,
        connectionId: "icn_compile_datadog_mcp_openai",
        kind: IntegrationBindingKinds.AGENT,
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
      {
        id: "ibd_compile_datadog_mcp_datadog",
        sandboxProfileId: "sbp_compile_datadog_mcp",
        sandboxProfileVersion: 1,
        connectionId: "icn_compile_datadog_mcp_datadog",
        kind: IntegrationBindingKinds.CONNECTOR,
        config: {
          tools: [DatadogToolIds.DATADOG_MCP],
        },
      },
    ]);

    const runtimePlan = await compileProfileVersionRuntimePlan(
      {
        db: fixture.db,
        integrationsConfig: fixture.config.integrations,
      },
      {
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_compile_datadog_mcp",
        profileVersion: 1,
        image: {
          source: "base",
          imageRef: "mistle/sandbox-base:dev",
        },
      },
    );

    const datadogRoute = runtimePlan.egressRoutes.find(
      (route) => route.upstream.baseUrl === "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
    );

    expect(datadogRoute).toBeDefined();
    expect(datadogRoute).toMatchObject({
      match: {
        hosts: ["mcp.datadoghq.com"],
        pathPrefixes: ["/api/unstable/mcp-server/mcp"],
      },
      authInjection: {
        type: "header",
        target: "dd_api_key",
      },
      additionalCredentialHeaders: [
        {
          header: "dd_application_key",
          credentialResolver: {
            connectionId: "icn_compile_datadog_mcp_datadog",
            secretType: "api_key",
            slotKey: "datadog.datadog-default.api-key.application-key",
          },
        },
      ],
    });
    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain(
      "[mcp_servers.datadog]",
    );
    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain(
      'url = "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp?toolsets=all"',
    );
  });

  it("returns profile not found when the sandbox profile does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-missing-profile@example.com",
    });

    try {
      await compileProfileVersionRuntimePlan(
        {
          db: fixture.db,
          integrationsConfig: fixture.config.integrations,
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_compile_missing_profile",
          profileVersion: 1,
          image: {
            source: "base",
            imageRef: "mistle/sandbox-base:dev",
          },
        },
      );
      throw new Error("Expected compileProfileVersionRuntimePlan to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxProfilesNotFoundError);

      if (error instanceof SandboxProfilesNotFoundError) {
        expect(error.code).toBe(SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND);
      }
    }
  });

  it("returns profile version not found when the version does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-missing-version@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_missing_version",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Missing Version Profile",
      status: "active",
    });

    try {
      await compileProfileVersionRuntimePlan(
        {
          db: fixture.db,
          integrationsConfig: fixture.config.integrations,
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_compile_missing_version",
          profileVersion: 9,
          image: {
            source: "base",
            imageRef: "mistle/sandbox-base:dev",
          },
        },
      );
      throw new Error("Expected compileProfileVersionRuntimePlan to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxProfilesNotFoundError);

      if (error instanceof SandboxProfilesNotFoundError) {
        expect(error.code).toBe(SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND);
      }
    }
  });

  it("fails when a binding references a connection from another organization", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-missing-connection@example.com",
    });
    const inaccessibleConnectionSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-connection-foreign-org@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_missing_connection",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Missing Connection Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_missing_connection",
      version: 1,
    });
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "openai-default-missing-connection",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com/v1",
        },
      })
      .onConflictDoNothing();
    await fixture.db.insert(integrationConnections).values({
      id: "icn_missing",
      organizationId: inaccessibleConnectionSession.organizationId,
      targetKey: "openai-default-missing-connection",
      displayName: "Foreign Compile Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_compile_missing_connection",
      sandboxProfileId: "sbp_compile_missing_connection",
      sandboxProfileVersion: 1,
      connectionId: "icn_missing",
      kind: IntegrationBindingKinds.AGENT,
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
    });

    try {
      await compileProfileVersionRuntimePlan(
        {
          db: fixture.db,
          integrationsConfig: fixture.config.integrations,
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_compile_missing_connection",
          profileVersion: 1,
          image: {
            source: "base",
            imageRef: "mistle/sandbox-base:dev",
          },
        },
      );
      throw new Error("Expected compileProfileVersionRuntimePlan to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxProfilesCompileError);

      if (error instanceof SandboxProfilesCompileError) {
        expect(error.code).toBe(
          SandboxProfilesCompileErrorCodes.INVALID_BINDING_CONNECTION_REFERENCE,
        );
      }
    }
  });

  it("fails when a target has invalid encrypted secrets", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-invalid-target-secrets@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_invalid_target_secrets",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Invalid Target Secrets Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_invalid_target_secrets",
      version: 1,
    });
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "openai-default-invalid-target-secrets",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com/v1",
        },
        secrets: {
          masterKeyVersion: 999,
          nonce: "invalid",
          ciphertext: "invalid",
        },
      })
      .onConflictDoNothing();
    await fixture.db.insert(integrationConnections).values({
      id: "icn_compile_invalid_target_secrets",
      organizationId: authenticatedSession.organizationId,
      targetKey: "openai-default-invalid-target-secrets",
      displayName: "Invalid Secrets Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_compile_invalid_target_secrets",
      sandboxProfileId: "sbp_compile_invalid_target_secrets",
      sandboxProfileVersion: 1,
      connectionId: "icn_compile_invalid_target_secrets",
      kind: IntegrationBindingKinds.AGENT,
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
    });

    try {
      await compileProfileVersionRuntimePlan(
        {
          db: fixture.db,
          integrationsConfig: fixture.config.integrations,
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_compile_invalid_target_secrets",
          profileVersion: 1,
          image: {
            source: "base",
            imageRef: "mistle/sandbox-base:dev",
          },
        },
      );
      throw new Error("Expected compileProfileVersionRuntimePlan to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxProfilesCompileError);

      if (error instanceof SandboxProfilesCompileError) {
        expect(error.code).toBe(SandboxProfilesCompileErrorCodes.INVALID_TARGET_SECRETS);
      }
    }
  });
});
