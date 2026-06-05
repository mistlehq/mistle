/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { getLocalPreparedRuntimeSandboxBaseImageRef } from "@mistle/config";
import {
  ApiKeyActorKinds,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionAgentRuntimeIds,
  type SandboxProfileVersionAgentRuntimeId,
  type SandboxProfileVersionSkillsConfig,
} from "@mistle/db/control-plane";
import {
  IntegrationConnectionMethodIds,
  type RuntimeArtifactInstallStep,
} from "@mistle/integrations-core";
import {
  DatadogToolIds,
  OpenAiChatGptBaseUrl,
  OpenAiChatGptOriginBaseUrl,
  OpenAiChatGptResponsesApiBaseUrl,
  OpenAiConnectionMethodIds,
} from "@mistle/integrations-definitions";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
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
import { IntegrationIntegrationsConfig } from "./helpers/integration-connections.js";
import {
  integrationConnectionRow,
  sandboxProfileRow,
  sandboxProfileVersionIntegrationBindingRow,
  sandboxProfileVersionRow,
} from "./helpers/sandbox-profiles.js";

const GitHubCliTokenPattern = /^ghp_[A-Za-z0-9]{36}$/u;
const LocalPreparedRuntimeSandboxBaseImageRef = getLocalPreparedRuntimeSandboxBaseImageRef();

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("sandbox profile compile runtime plan integration", () => {
  it("compiles runtime plan from version bindings, connections, and targets", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-success@example.com",
    });

    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_success",
      setupScript: "printf 'hello from setup script\\n'",
    });
    await seedOpenAiAgentBinding(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_success",
      targetKey: "openai-default-compile-runtime-plan",
      connectionId: "icn_compile_success",
      bindingId: "ibd_compile_success",
    });

    const runtimePlan = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_success",
    });

    expect(runtimePlan.sandboxProfileId).toBe("sbp_compile_success");
    expect(runtimePlan.version).toBe(1);
    expect(runtimePlan.setupScript).toBe("printf 'hello from setup script\\n'");
    expect(runtimePlan.egressRoutes).toHaveLength(1);
    expect(runtimePlan.artifacts[0]).toMatchObject({
      artifactKey: "codex-cli",
      name: "Codex CLI",
    });

    const installCommand = expectGitHubReleaseInstallStep(
      runtimePlan.artifacts[0]?.lifecycle.install[0],
    );
    expect(installCommand).toMatchObject({
      op: "github_release_install",
      repository: "openai/codex",
      release: {
        kind: "tag",
        match: "exact",
        tag: "rust-v0.137.0",
      },
      installPath: "/usr/local/bin/codex",
      timeoutMs: 120_000,
    });

    expect(runtimePlan.runtimeClients[0]).toMatchObject({
      clientId: "codex-cli",
      setup: {
        env: {},
        files: [
          {
            fileId: "codex_config",
            path: "/etc/codex/config.toml",
            mode: 384,
            writeMode: "if-absent",
          },
          {
            fileId: "codex_global_agents",
            path: "/root/.codex/AGENTS.md",
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
            timeoutMs: 60_000,
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

    const configContent = readSetupFileContent(runtimePlan, "codex_config");
    const agentsContent = readSetupFileContent(runtimePlan, "codex_global_agents");
    expect(configContent).toContain('model_provider = "proxy"');
    expect(configContent).toContain('approval_policy = "never"');
    expect(configContent).toContain('sandbox_mode = "danger-full-access"');
    expect(configContent).toContain("[model_providers.proxy]");
    expect(configContent).toContain('base_url = "https://api.openai.com/v1"');
    expect(configContent).toContain('wire_api = "responses"');
    expect(configContent).toContain("requires_openai_auth = false");
    expect(configContent).toContain("supports_websockets = true");
    expect(configContent).toContain('[projects."/"]');
    expect(configContent).toContain("[features]");
    expect(configContent).toContain("tool_search = true");
    expect(configContent).not.toContain("[mcp_servers.mistle]");
    expect(configContent).not.toContain("model =");
    expect(configContent).not.toContain("developer_instructions");
    expect(agentsContent).toContain("Mistle-managed sandbox context:");
    expect(agentsContent).toContain("managed outbound proxy");
    expect(agentsContent).not.toContain("User-provided additional instructions:");
  });

  it("omits blank setup scripts from the compiled runtime plan", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-blank-setup-script@example.com",
    });

    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_blank_setup_script",
      setupScript: "   \n\t  ",
    });
    await seedOpenAiAgentBinding(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_blank_setup_script",
      targetKey: "openai-default-compile-blank-setup-script",
      connectionId: "icn_compile_blank_setup_script_openai",
      bindingId: "ibd_compile_blank_setup_script_openai",
    });

    const runtimePlan = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_blank_setup_script",
    });

    expect(runtimePlan.setupScript).toBeUndefined();
  });

  it("includes selected skills when the source repository is in the runtime plan", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-skills@example.com",
    });

    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_skills",
      skillsConfig: {
        originUrl: "https://github.com/mistlehq/mistle.git",
        selectedSkills: [
          {
            name: "github-pr-authoring",
            relativePath: ".agents/skills/github-pr-authoring",
          },
        ],
      },
    });
    await seedConnectorBindings(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_skills",
      bindings: [
        githubBinding({
          targetKey: "github-cloud-compile-skills",
          connectionId: "icn_compile_skills_github",
          bindingId: "ibd_compile_skills_github",
          tools: [],
        }),
      ],
    });

    const runtimePlan = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_skills",
    });

    expect(runtimePlan.skills).toEqual({
      originUrl: "https://github.com/mistlehq/mistle.git",
      selectedSkills: [
        {
          name: "github-pr-authoring",
          relativePath: ".agents/skills/github-pr-authoring",
        },
      ],
    });
  });

  it("includes selected public GitHub skills as an uncredentialed workspace source", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-public-skills@example.com",
    });

    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_public_skills",
      skillsConfig: {
        originUrl: "https://github.com/mistlehq/skills.git",
        selectedSkills: [
          {
            name: "github-pr-authoring",
            relativePath: ".agents/skills/github-pr-authoring",
          },
        ],
      },
    });

    const runtimePlan = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_public_skills",
    });

    expect(runtimePlan.workspaceSources).toContainEqual({
      sourceKind: "git-clone",
      resourceKind: "repository",
      path: "/root/mistlehq/skills",
      originUrl: "https://github.com/mistlehq/skills.git",
    });
    expect(runtimePlan.egressRoutes).toEqual([]);
    expect(runtimePlan.skills).toEqual({
      originUrl: "https://github.com/mistlehq/skills.git",
      selectedSkills: [
        {
          name: "github-pr-authoring",
          relativePath: ".agents/skills/github-pr-authoring",
        },
      ],
    });
  });

  it("rejects public GitHub skills sources that conflict with an existing workspace path", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-public-skills-path-conflict@example.com",
    });

    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_public_skills_path_conflict",
      skillsConfig: {
        originUrl: "https://github.com/acme/skills.git",
        selectedSkills: [],
      },
    });
    await seedConnectorBindings(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_public_skills_path_conflict",
      bindings: [
        githubBinding({
          targetKey: "github-enterprise-compile-public-skills-path-conflict",
          connectionId: "icn_compile_public_skills_path_conflict_github",
          bindingId: "ibd_compile_public_skills_path_conflict_github",
          tools: [],
          variantId: "github-enterprise-server",
          apiBaseUrl: "https://ghe.example.com/api/v3",
          webBaseUrl: "https://ghe.example.com",
          repositories: ["acme/skills"],
        }),
      ],
    });

    await expect(
      compilePlan(env, {
        organizationId: session.organizationId,
        profileId: "sbp_compile_public_skills_path_conflict",
      }),
    ).rejects.toMatchObject({
      code: SandboxProfilesCompileErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
      message:
        "Public skills source 'https://github.com/acme/skills.git' uses workspace path '/root/acme/skills' that is already used by workspace source 'https://ghe.example.com/acme/skills.git'.",
    });
  });

  it("uses the ChatGPT responses base URL for chatgpt-device-code connections", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-chatgpt-base-url@example.com",
    });

    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_chatgpt_base_url",
    });
    await seedOpenAiAgentBinding(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_chatgpt_base_url",
      targetKey: "openai-default-compile-runtime-plan-chatgpt",
      connectionId: "icn_compile_chatgpt_base_url",
      bindingId: "ibd_compile_chatgpt_base_url",
      connectionConfig: {
        connection_method: OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE,
        auth_mode: "chatgpt",
        chatgpt_account_id: "acct_123",
        chatgpt_plan_type: "pro",
      },
    });

    const runtimePlan = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_chatgpt_base_url",
    });

    expect(runtimePlan.egressRoutes[0]?.upstream.baseUrl).toBe(OpenAiChatGptOriginBaseUrl);
    expect(runtimePlan.egressRoutes[0]?.additionalHeaders).toEqual({
      "ChatGPT-Account-ID": "acct_123",
    });

    const configContent = readSetupFileContent(runtimePlan, "codex_config");
    expect(configContent).toContain(`base_url = "${OpenAiChatGptResponsesApiBaseUrl}"`);
    expect(configContent).toContain(`chatgpt_base_url = "${OpenAiChatGptBaseUrl}"`);
  });

  it("omits optional github and jira cli artifacts when bindings do not select tools", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-no-optional-tools@example.com",
    });

    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_optional_tools_none",
    });
    await seedConnectorBindings(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_optional_tools_none",
      bindings: [
        githubBinding({
          targetKey: "github-cloud-compile-no-tools",
          connectionId: "icn_compile_no_tools_github",
          bindingId: "ibd_compile_no_tools_github",
          tools: [],
        }),
        jiraBinding({
          targetKey: "jira-default-compile-no-tools",
          connectionId: "icn_compile_no_tools_jira",
          bindingId: "ibd_compile_no_tools_jira",
          tools: [],
        }),
      ],
    });

    const runtimePlan = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_optional_tools_none",
    });

    expect(runtimePlan.artifacts.map((artifact) => artifact.artifactKey)).toEqual(["codex-cli"]);
  });

  it("installs selected github, jira, and slack cli artifacts once each", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-selected-tools@example.com",
    });

    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_selected_tools",
    });
    await seedConnectorBindings(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_selected_tools",
      bindings: [
        githubBinding({
          targetKey: "github-cloud-compile-selected-tools",
          connectionId: "icn_compile_selected_tools_github",
          bindingId: "ibd_compile_selected_tools_github",
          tools: ["github-cli"],
        }),
        jiraBinding({
          targetKey: "jira-default-compile-selected-tools-secondary",
          connectionId: "icn_compile_selected_tools_jira_a",
          bindingId: "ibd_compile_selected_tools_jira_a",
          tools: ["jira-cli"],
        }),
        jiraBinding({
          targetKey: "jira-default-compile-selected-tools",
          connectionId: "icn_compile_selected_tools_jira_b",
          bindingId: "ibd_compile_selected_tools_jira_b",
          siteUrl: "https://mistle-dev.atlassian.net",
          tools: ["jira-cli"],
        }),
        slackBinding({
          targetKey: "slack-default-compile-selected-tools",
          connectionId: "icn_compile_selected_tools_slack",
          bindingId: "ibd_compile_selected_tools_slack",
          tools: ["slack-cli"],
        }),
      ],
    });

    const runtimePlan = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_selected_tools",
    });

    expect(runtimePlan.artifacts.map((artifact) => artifact.artifactKey)).toEqual([
      "codex-cli",
      "gh-cli",
      "jira-cli",
      "slack-cli",
    ]);
    const githubArtifact = readArtifact(runtimePlan, "gh-cli");
    const jiraArtifact = readArtifact(runtimePlan, "jira-cli");
    const slackArtifact = readArtifact(runtimePlan, "slack-cli");

    expect(githubArtifact.env).toEqual({
      GH_TOKEN: expect.stringMatching(GitHubCliTokenPattern),
    });
    expectExecInstallStep(githubArtifact.lifecycle.install[0]);
    expect(jiraArtifact.env).toEqual({
      JIRA_BASE_URL: "https://mistle.atlassian.net",
    });
    expectGitHubReleaseInstallStep(jiraArtifact.lifecycle.install[0]);
    expect(slackArtifact.env).toEqual({
      SLACK_BASE_URL: "https://slack.com/api",
    });
    expectGitHubReleaseInstallStep(slackArtifact.lifecycle.install[0]);
  });

  it("configures selected Jira and Slack MCP tools as local runtime processes", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-jira-slack-mcp@example.com",
    });

    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_jira_slack_mcp",
    });
    await seedOpenAiAgentBinding(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_jira_slack_mcp",
      targetKey: "openai-default-compile-jira-slack-mcp",
      connectionId: "icn_compile_jira_slack_mcp_openai",
      bindingId: "ibd_compile_jira_slack_mcp_openai",
    });
    await seedConnectorBindings(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_jira_slack_mcp",
      bindings: [
        jiraBinding({
          targetKey: "jira-default-compile-mcp",
          connectionId: "icn_compile_jira_mcp",
          bindingId: "ibd_compile_jira_mcp",
          tools: ["jira-mcp"],
        }),
        slackBinding({
          targetKey: "slack-default-compile-mcp",
          connectionId: "icn_compile_slack_mcp",
          bindingId: "ibd_compile_slack_mcp",
          tools: ["slack-mcp"],
        }),
      ],
      includeAgent: false,
    });

    const runtimePlan = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_jira_slack_mcp",
    });

    expect(runtimePlan.artifacts.map((artifact) => artifact.artifactKey)).toEqual([
      "codex-cli",
      "jira-cli",
      "slack-cli",
    ]);
    const configContent = readSetupFileContent(runtimePlan, "codex_config");
    expect(configContent).toContain("[mcp_servers.jira]");
    expect(configContent).toContain('url = "http://127.0.0.1:7345/mcp"');
    expect(configContent).toContain("[mcp_servers.slack]");
    expect(configContent).toContain('url = "http://127.0.0.1:7346/mcp"');
    expect(runtimePlan.runtimeClients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientId: "jira-mcp",
          setup: {
            env: {},
            files: [],
          },
          processes: [
            {
              processKey: "jira-mcp-server",
              command: {
                args: [
                  "/usr/local/bin/jira",
                  "mcp",
                  "serve",
                  "--addr",
                  "127.0.0.1:7345",
                  "--endpoint",
                  "/mcp",
                ],
              },
              readiness: {
                type: "tcp",
                host: "127.0.0.1",
                port: 7345,
                timeoutMs: 60_000,
              },
              stop: {
                signal: "sigterm",
                timeoutMs: 10_000,
                gracePeriodMs: 2_000,
              },
            },
          ],
          endpoints: [],
        }),
        expect.objectContaining({
          clientId: "slack-mcp",
          setup: {
            env: {},
            files: [],
          },
          processes: [
            {
              processKey: "slack-mcp-server",
              command: {
                args: [
                  "/usr/local/bin/slack",
                  "mcp",
                  "serve",
                  "--addr",
                  "127.0.0.1:7346",
                  "--endpoint",
                  "/mcp",
                ],
              },
              readiness: {
                type: "tcp",
                host: "127.0.0.1",
                port: 7346,
                timeoutMs: 60_000,
              },
              stop: {
                signal: "sigterm",
                timeoutMs: 10_000,
                gracePeriodMs: 2_000,
              },
            },
          ],
          endpoints: [],
        }),
      ]),
    );
  });

  it("includes Linear API egress without MCP config when Linear MCP is not selected", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-linear-api-only@example.com",
    });

    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_linear_api_only",
    });
    await seedOpenAiAgentBinding(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_linear_api_only",
      targetKey: "openai-default-compile-linear-api-only",
      connectionId: "icn_compile_linear_api_only_openai",
      bindingId: "ibd_compile_linear_api_only_openai",
    });
    await seedConnectorBindings(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_linear_api_only",
      bindings: [
        linearBinding({
          targetKey: "linear-default-compile-linear-api-only",
          connectionId: "icn_compile_linear_api_only_linear",
          bindingId: "ibd_compile_linear_api_only_linear",
          tools: [],
        }),
      ],
      includeAgent: false,
    });

    const runtimePlan = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_linear_api_only",
    });

    expect(hasEgressRoute(runtimePlan, "https://api.linear.app", "api.linear.app")).toBe(true);
    expect(hasHost(runtimePlan, "mcp.linear.app")).toBe(false);
    expect(readSetupFileContent(runtimePlan, "codex_config")).not.toContain("[mcp_servers.linear]");
  });

  it("includes Linear MCP config and egress when Linear MCP is selected", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-linear-mcp@example.com",
    });

    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_linear_mcp",
    });
    await seedOpenAiAgentBinding(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_linear_mcp",
      targetKey: "openai-default-compile-linear-mcp",
      connectionId: "icn_compile_linear_mcp_openai",
      bindingId: "ibd_compile_linear_mcp_openai",
    });
    await seedConnectorBindings(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_linear_mcp",
      bindings: [
        linearBinding({
          targetKey: "linear-default-compile-linear-mcp",
          connectionId: "icn_compile_linear_mcp_linear",
          bindingId: "ibd_compile_linear_mcp_linear",
          tools: ["linear-mcp"],
        }),
      ],
      includeAgent: false,
    });

    const runtimePlan = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_linear_mcp",
    });

    expect(hasEgressRoute(runtimePlan, "https://api.linear.app", "api.linear.app")).toBe(true);
    expect(hasHost(runtimePlan, "mcp.linear.app")).toBe(true);
    const configContent = readSetupFileContent(runtimePlan, "codex_config");
    expect(configContent).toContain("[mcp_servers.linear]");
    expect(configContent).toContain('url = "https://mcp.linear.app/mcp"');
  });

  it("includes Datadog MCP config and egress with credential-backed headers", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-datadog-mcp@example.com",
    });

    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_datadog_mcp",
    });
    await seedOpenAiAgentBinding(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_datadog_mcp",
      targetKey: "openai-default-compile-datadog-mcp",
      connectionId: "icn_compile_datadog_mcp_openai",
      bindingId: "ibd_compile_datadog_mcp_openai",
    });
    await seedConnectorBindings(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_datadog_mcp",
      bindings: [
        datadogBinding({
          targetKey: "datadog-default-compile-datadog-mcp",
          connectionId: "icn_compile_datadog_mcp_datadog",
          bindingId: "ibd_compile_datadog_mcp_datadog",
          tools: [DatadogToolIds.DATADOG_MCP],
        }),
      ],
      includeAgent: false,
    });

    const runtimePlan = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_datadog_mcp",
    });

    const datadogRoute = runtimePlan.egressRoutes.find(
      (route) => route.upstream.baseUrl === "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
    );

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
    const configContent = readSetupFileContent(runtimePlan, "codex_config");
    expect(configContent).toContain("[mcp_servers.datadog]");
    expect(configContent).toContain(
      'url = "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp?toolsets=all"',
    );
  });

  it("includes Mistle MCP config for Codex when enabled on the profile version", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-mistle-mcp-codex@example.com",
    });
    const apiKeyId = "apk_compile_mistle_mcp_codex";

    await seedMistleMcpApiKey(env, {
      organizationId: session.organizationId,
      apiKeyId,
      secretPrefix: "compile_mistle_mcp_codex",
    });
    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_mistle_mcp_codex",
      mistleMcpApiKeyId: apiKeyId,
    });
    await seedOpenAiAgentBinding(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_mistle_mcp_codex",
      targetKey: "openai-default-compile-mistle-mcp-codex",
      connectionId: "icn_compile_mistle_mcp_codex_openai",
      bindingId: "ibd_compile_mistle_mcp_codex_openai",
    });

    const runtimePlan = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_mistle_mcp_codex",
    });

    const configContent = readSetupFileContent(runtimePlan, "codex_config");
    expect(configContent).toContain("[mcp_servers.mistle]");
    expect(configContent).toContain('url = "https://mcp.example.test/mcp"');
    expect(runtimePlan.egressRoutes).toContainEqual({
      egressRuleId: "egress_rule_platform_mistle_mcp",
      bindingId: "platform-mistle-mcp",
      familyId: "mistle",
      variantId: "mistle-mcp",
      match: {
        hosts: ["mcp.example.test"],
        pathPrefixes: ["/mcp"],
      },
      upstream: {
        baseUrl: "https://mcp.example.test/mcp",
      },
      authInjection: {
        type: "bearer",
        target: "authorization",
      },
      credentialResolver: {
        kind: "mistle_mcp_token",
        apiKeyId,
      },
    });
  });

  it("includes Mistle MCP config for OpenCode when enabled on the profile version", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-mistle-mcp-opencode@example.com",
    });
    const apiKeyId = "apk_compile_mistle_mcp_opencode";

    await seedMistleMcpApiKey(env, {
      organizationId: session.organizationId,
      apiKeyId,
      secretPrefix: "compile_mistle_mcp_opencode",
    });
    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_mistle_mcp_opencode",
      agentRuntimeId: SandboxProfileVersionAgentRuntimeIds.OPENCODE,
      mistleMcpApiKeyId: apiKeyId,
    });

    const runtimePlan = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_mistle_mcp_opencode",
    });

    expect(JSON.parse(readSetupFileContent(runtimePlan, "opencode_config"))).toMatchObject({
      mcp: {
        mistle: {
          url: "https://mcp.example.test/mcp",
        },
      },
    });
  });

  it("includes Mistle MCP config for Pi when enabled on the profile version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-mistle-mcp-pi@example.com",
    });
    const apiKeyId = "apk_compile_mistle_mcp_pi";

    await seedMistleMcpApiKey(env, {
      organizationId: session.organizationId,
      apiKeyId,
      secretPrefix: "compile_mistle_mcp_pi",
    });
    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_mistle_mcp_pi",
      agentRuntimeId: SandboxProfileVersionAgentRuntimeIds.PI,
      mistleMcpApiKeyId: apiKeyId,
    });

    const runtimePlan = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_mistle_mcp_pi",
    });

    expect(JSON.parse(readSetupFileContent(runtimePlan, "pi_mcp_config"))).toEqual({
      settings: {
        disableProxyTool: false,
      },
      mcpServers: {
        mistle: {
          url: "https://mcp.example.test/mcp",
          lifecycle: "lazy",
          directTools: false,
        },
      },
    });
  });

  it("returns profile not found when the sandbox profile does not exist", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-missing-profile@example.com",
    });

    const error = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_missing_profile",
    }).then(
      () => {
        throw new Error("Expected compileProfileVersionRuntimePlan to throw.");
      },
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(SandboxProfilesNotFoundError);
    if (!(error instanceof SandboxProfilesNotFoundError)) {
      throw error;
    }
    expect(error.code).toBe(SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND);
  });

  it("returns profile version not found when the version does not exist", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-missing-version@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_compile_missing_version",
        organizationId: session.organizationId,
        displayName: "Compile Missing Version Profile",
        createdAt: "2026-04-24T00:00:00.000Z",
      }),
    );

    const error = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_missing_version",
      profileVersion: 9,
    }).then(
      () => {
        throw new Error("Expected compileProfileVersionRuntimePlan to throw.");
      },
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(SandboxProfilesNotFoundError);
    if (!(error instanceof SandboxProfilesNotFoundError)) {
      throw error;
    }
    expect(error.code).toBe(SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND);
  });

  it("fails when a binding references a connection from another organization", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-missing-connection@example.com",
    });
    const otherSession = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-connection-foreign-org@example.com",
    });

    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_missing_connection",
    });
    await seedOpenAiAgentBinding(env, {
      organizationId: otherSession.organizationId,
      profileId: "sbp_compile_missing_connection",
      targetKey: "openai-default-missing-connection",
      connectionId: "icn_missing",
      bindingId: "ibd_compile_missing_connection",
    });

    const error = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_missing_connection",
    }).then(
      () => {
        throw new Error("Expected compileProfileVersionRuntimePlan to throw.");
      },
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(SandboxProfilesCompileError);
    if (!(error instanceof SandboxProfilesCompileError)) {
      throw error;
    }
    expect(error.code).toBe(SandboxProfilesCompileErrorCodes.INVALID_BINDING_CONNECTION_REFERENCE);
  });

  it("fails when a target has invalid encrypted secrets", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-compile-invalid-target-secrets@example.com",
    });

    await createProfileVersion(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_invalid_target_secrets",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values({
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
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_compile_invalid_target_secrets",
        organizationId: session.organizationId,
        targetKey: "openai-default-invalid-target-secrets",
        displayName: "Invalid Secrets Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_compile_invalid_target_secrets",
          sandboxProfileId: "sbp_compile_invalid_target_secrets",
          sandboxProfileVersion: 1,
          connectionId: "icn_compile_invalid_target_secrets",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      );

    const error = await compilePlan(env, {
      organizationId: session.organizationId,
      profileId: "sbp_compile_invalid_target_secrets",
    }).then(
      () => {
        throw new Error("Expected compileProfileVersionRuntimePlan to throw.");
      },
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(SandboxProfilesCompileError);
    if (!(error instanceof SandboxProfilesCompileError)) {
      throw error;
    }
    expect(error.code).toBe(SandboxProfilesCompileErrorCodes.INVALID_TARGET_SECRETS);
  });
});

type RuntimePlan = Awaited<ReturnType<typeof compileProfileVersionRuntimePlan>>;

type ConnectorBindingInput = {
  target: {
    targetKey: string;
    familyId: string;
    variantId: string;
    config: Record<string, unknown>;
  };
  connection: {
    id: string;
    displayName: string;
    config: Record<string, unknown>;
  };
  binding: {
    id: string;
    kind: typeof IntegrationBindingKinds.GIT | typeof IntegrationBindingKinds.CONNECTOR;
    config: Record<string, unknown>;
  };
};

async function compilePlan(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    profileId: string;
    profileVersion?: number;
  },
): Promise<RuntimePlan> {
  return compileProfileVersionRuntimePlan(
    {
      db: env.controlPlaneDb,
      integrationsConfig: IntegrationIntegrationsConfig,
      mcpConfig: {
        url: "https://mcp.example.test/mcp",
        trustForwardedHeaders: false,
        auth: {
          secret: "mcp-runtime-token-secret",
          issuer: "control-plane-api",
          audience: "mistle-mcp",
        },
      },
    },
    {
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion ?? 1,
      image: {
        source: "base",
        imageRef: LocalPreparedRuntimeSandboxBaseImageRef,
      },
    },
  );
}

async function createProfileVersion(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    profileId: string;
    setupScript?: string;
    agentRuntimeId?: SandboxProfileVersionAgentRuntimeId;
    mistleMcpApiKeyId?: string;
    skillsConfig?: SandboxProfileVersionSkillsConfig | null;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
    sandboxProfileRow({
      id: input.profileId,
      organizationId: input.organizationId,
      displayName: "Compile Runtime Plan Profile",
      createdAt: "2026-04-24T00:00:00.000Z",
    }),
  );
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
    sandboxProfileVersionRow({
      sandboxProfileId: input.profileId,
      version: 1,
      ...(input.setupScript === undefined ? {} : { setupScript: input.setupScript }),
      ...(input.agentRuntimeId === undefined ? {} : { agentRuntimeId: input.agentRuntimeId }),
      ...(input.mistleMcpApiKeyId === undefined
        ? {}
        : { mistleMcpEnabled: true, mistleMcpApiKeyId: input.mistleMcpApiKeyId }),
      ...(input.skillsConfig === undefined ? {} : { skillsConfig: input.skillsConfig }),
    }),
  );
}

async function seedMistleMcpApiKey(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    apiKeyId: string;
    secretPrefix: string;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.apiKeys).values({
    id: input.apiKeyId,
    name: "Compile Mistle MCP API Key",
    organizationId: input.organizationId,
    secretPrefix: input.secretPrefix,
    secretHash: "sha256-test-hash",
    secretHashAlgorithm: "sha256-v1",
    createdByActorKind: ApiKeyActorKinds.USER,
    createdByActorId: "usr_compile_mistle_mcp",
  });
}

async function seedOpenAiAgentBinding(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    profileId: string;
    targetKey: string;
    connectionId: string;
    bindingId: string;
    connectionConfig?: Record<string, unknown>;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values({
    targetKey: input.targetKey,
    familyId: "openai",
    variantId: "openai-default",
    enabled: true,
    config: {
      api_base_url: "https://api.openai.com/v1",
    },
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
    integrationConnectionRow({
      id: input.connectionId,
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      displayName: "Compile Runtime Plan OpenAI Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: input.connectionConfig ?? {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
    }),
  );
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values(
      sandboxProfileVersionIntegrationBindingRow({
        id: input.bindingId,
        sandboxProfileId: input.profileId,
        sandboxProfileVersion: 1,
        connectionId: input.connectionId,
        kind: IntegrationBindingKinds.AGENT,
        config: {},
      }),
    );
}

async function seedConnectorBindings(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    profileId: string;
    bindings: ConnectorBindingInput[];
    includeAgent?: boolean;
  },
): Promise<void> {
  if (input.includeAgent !== false) {
    await seedOpenAiAgentBinding(env, {
      organizationId: input.organizationId,
      profileId: input.profileId,
      targetKey: `openai-${input.profileId}`,
      connectionId: `icn_${input.profileId}_openai`,
      bindingId: `ibd_${input.profileId}_openai`,
    });
  }

  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
    input.bindings.map((binding) => ({
      targetKey: binding.target.targetKey,
      familyId: binding.target.familyId,
      variantId: binding.target.variantId,
      enabled: true,
      config: binding.target.config,
    })),
  );
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
    input.bindings.map((binding) =>
      integrationConnectionRow({
        id: binding.connection.id,
        organizationId: input.organizationId,
        targetKey: binding.target.targetKey,
        displayName: binding.connection.displayName,
        status: IntegrationConnectionStatuses.ACTIVE,
        config: binding.connection.config,
      }),
    ),
  );
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values(
      input.bindings.map((binding) =>
        sandboxProfileVersionIntegrationBindingRow({
          id: binding.binding.id,
          sandboxProfileId: input.profileId,
          sandboxProfileVersion: 1,
          connectionId: binding.connection.id,
          kind: binding.binding.kind,
          config: binding.binding.config,
        }),
      ),
    );
}

function githubBinding(input: {
  targetKey: string;
  connectionId: string;
  bindingId: string;
  tools: string[];
  variantId?: "github-cloud" | "github-enterprise-server";
  apiBaseUrl?: string;
  webBaseUrl?: string;
  repositories?: string[];
}): ConnectorBindingInput {
  return {
    target: {
      targetKey: input.targetKey,
      familyId: "github",
      variantId: input.variantId ?? "github-cloud",
      config: {
        api_base_url: input.apiBaseUrl ?? "https://api.github.com",
        web_base_url: input.webBaseUrl ?? "https://github.com",
      },
    },
    connection: {
      id: input.connectionId,
      displayName: "Compile Runtime Plan GitHub Connection",
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
    },
    binding: {
      id: input.bindingId,
      kind: IntegrationBindingKinds.GIT,
      config: {
        repositories: input.repositories ?? ["mistlehq/mistle"],
        tools: input.tools,
      },
    },
  };
}

function jiraBinding(input: {
  targetKey: string;
  connectionId: string;
  bindingId: string;
  tools: string[];
  siteUrl?: string;
}): ConnectorBindingInput {
  return {
    target: {
      targetKey: input.targetKey,
      familyId: "jira",
      variantId: "jira-default",
      config: {},
    },
    connection: {
      id: input.connectionId,
      displayName: "Compile Runtime Plan Jira Connection",
      config: {
        connection_method: "jira-personal-api-token",
        site_url: input.siteUrl ?? "https://mistle.atlassian.net",
        email: "user@example.com",
      },
    },
    binding: {
      id: input.bindingId,
      kind: IntegrationBindingKinds.CONNECTOR,
      config: {
        tools: input.tools,
      },
    },
  };
}

function slackBinding(input: {
  targetKey: string;
  connectionId: string;
  bindingId: string;
  tools: string[];
}): ConnectorBindingInput {
  return {
    target: {
      targetKey: input.targetKey,
      familyId: "slack",
      variantId: "slack-default",
      config: {
        api_base_url: "https://slack.com/api",
      },
    },
    connection: {
      id: input.connectionId,
      displayName: "Compile Runtime Plan Slack Connection",
      config: {
        connection_method: "slack-bot-token",
      },
    },
    binding: {
      id: input.bindingId,
      kind: IntegrationBindingKinds.CONNECTOR,
      config: {
        tools: input.tools,
      },
    },
  };
}

function linearBinding(input: {
  targetKey: string;
  connectionId: string;
  bindingId: string;
  tools: string[];
}): ConnectorBindingInput {
  return {
    target: {
      targetKey: input.targetKey,
      familyId: "linear",
      variantId: "linear-default",
      config: {},
    },
    connection: {
      id: input.connectionId,
      displayName: "Compile Runtime Plan Linear Connection",
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
    },
    binding: {
      id: input.bindingId,
      kind: IntegrationBindingKinds.CONNECTOR,
      config: {
        tools: input.tools,
      },
    },
  };
}

function datadogBinding(input: {
  targetKey: string;
  connectionId: string;
  bindingId: string;
  tools: string[];
}): ConnectorBindingInput {
  return {
    target: {
      targetKey: input.targetKey,
      familyId: "datadog",
      variantId: "datadog-default",
      config: {},
    },
    connection: {
      id: input.connectionId,
      displayName: "Compile Runtime Plan Datadog Connection",
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
    },
    binding: {
      id: input.bindingId,
      kind: IntegrationBindingKinds.CONNECTOR,
      config: {
        tools: input.tools,
      },
    },
  };
}

function expectArtifactInstallStep(
  step: RuntimeArtifactInstallStep | undefined,
): RuntimeArtifactInstallStep {
  if (step === undefined) {
    throw new Error("Expected artifact install step.");
  }

  return step;
}

function readArtifact(
  runtimePlan: RuntimePlan,
  artifactKey: string,
): RuntimePlan["artifacts"][number] {
  const artifact = runtimePlan.artifacts.find((candidate) => candidate.artifactKey === artifactKey);

  if (artifact === undefined) {
    throw new Error(`Expected runtime plan to include artifact ${artifactKey}.`);
  }

  return artifact;
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

function readSetupFileContent(runtimePlan: RuntimePlan, fileId: string): string {
  const content = runtimePlan.runtimeClients[0]?.setup.files.find(
    (file) => file.fileId === fileId,
  )?.content;
  if (content === undefined) {
    throw new Error(`Expected runtime plan setup file '${fileId}'.`);
  }

  return content;
}

function hasEgressRoute(runtimePlan: RuntimePlan, baseUrl: string, host: string): boolean {
  return runtimePlan.egressRoutes.some(
    (route) => route.upstream.baseUrl === baseUrl && route.match.hosts.includes(host),
  );
}

function hasHost(runtimePlan: RuntimePlan, host: string): boolean {
  return runtimePlan.egressRoutes.some((route) => route.match.hosts.includes(host));
}
