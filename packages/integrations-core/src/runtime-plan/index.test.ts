import { describe, expect, it } from "vitest";

import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import { assembleCompiledRuntimePlan, CompiledRuntimePlanSchema } from "./index.js";

const GitHubCliTokenPattern = /^ghp_[A-Za-z0-9]{36}$/;
const GitHubCliPlaceholderToken = [
  "g",
  "h",
  "p",
  "_",
  "G7aBNSK9WMQh0rgA",
  "lagCe4a7o75FPgRbQhls",
].join("");

function createPtyLaunch(input: { runtimeId: string; displayName?: string; command?: string }) {
  return {
    runtimeId: input.runtimeId,
    displayName: input.displayName ?? input.runtimeId,
    newLaunch: {
      ptySessionId: "cli",
      cols: 120,
      rows: 32,
      command: input.command ?? input.runtimeId,
      args: [],
    },
    resumeLaunch: {
      ptySessionId: "cli",
      cols: 120,
      rows: 32,
      command: input.command ?? input.runtimeId,
      args: [
        {
          kind: "literal" as const,
          value: "resume",
        },
        {
          kind: "threadId" as const,
        },
      ],
    },
  };
}

describe("assembleCompiledRuntimePlan", () => {
  it("accepts aws sigv4 egress routes in the shared runtime-plan schema", () => {
    const plan = assembleCompiledRuntimePlan({
      sandboxProfileId: "sbp_aws",
      version: 1,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      compiledBindingResults: [
        {
          egressRoutes: [
            {
              egressRuleId: "egress_rule_aws",
              bindingId: "ibd_aws",
              match: {
                hosts: ["sts.us-east-1.amazonaws.com"],
                methods: ["POST"],
              },
              upstream: {
                baseUrl: "https://sts.us-east-1.amazonaws.com",
              },
              authInjection: {
                type: "aws_sigv4",
                service: "sts",
                region: "us-east-1",
              },
              credentialResolver: {
                connectionId: "icn_aws",
                secretType: "aws_secret_access_key",
                resolverKey: "assume-role-session",
              },
            },
          ],
          artifacts: [],
          runtimeClients: [],
          workspaceSources: [],
          agentRuntimes: [],
        },
      ],
    });

    expect(CompiledRuntimePlanSchema.parse(plan)).toEqual(plan);
  });

  it("produces runtime plans accepted by the shared runtime-plan schema", () => {
    const plan = assembleCompiledRuntimePlan({
      sandboxProfileId: "sbp_123",
      version: 7,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      compiledBindingResults: [
        {
          egressRoutes: [],
          artifacts: [],
          runtimeClients: [
            {
              clientId: "codex-cli",
              setup: {
                env: {},
                files: [],
              },
              processes: [
                {
                  processKey: "codex-app-server",
                  command: {
                    args: ["/usr/local/bin/codex", "app-server"],
                  },
                  readiness: {
                    type: "none",
                  },
                  stop: {
                    signal: "sigterm",
                    timeoutMs: 10_000,
                  },
                },
              ],
              endpoints: [
                {
                  endpointKey: "app-server",
                  processKey: "codex-app-server",
                  transport: {
                    type: "ws",
                    url: "ws://127.0.0.1:4747",
                  },
                  connectionMode: "dedicated",
                },
              ],
            },
          ],
          workspaceSources: [],
          agentRuntimes: [
            {
              bindingId: "ibd_123",
              runtimeId: "codex",
              runtimeKey: "codex-app-server",
              clientId: "codex-cli",
              endpointKey: "app-server",
              ptyLaunch: createPtyLaunch({
                runtimeId: "codex",
                displayName: "Codex",
                command: "codex",
              }),
            },
          ],
        },
      ],
    });

    expect(CompiledRuntimePlanSchema.parse(plan)).toEqual(plan);
  });

  it("merges runtime client fragments and produces deterministic ordering", () => {
    const plan = assembleCompiledRuntimePlan({
      sandboxProfileId: "sbp_123",
      version: 7,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      compiledBindingResults: [
        {
          egressRoutes: [
            {
              egressRuleId: "egress_rule_b",
              bindingId: "bind_b",
              match: {
                hosts: ["api.github.com", "github.com"],
              },
              upstream: {
                baseUrl: "https://api.github.com",
              },
              authInjection: {
                type: "bearer",
                target: "authorization",
              },
              credentialResolver: {
                connectionId: "conn_b",
                secretType: "github_app_installation_token",
              },
            },
          ],
          artifacts: [
            {
              artifactKey: "gh-cli",
              name: "GitHub CLI",
              env: {
                Z_VAR: "two",
                A_VAR: "one",
              },
              lifecycle: {
                install: [{ op: "mise_install", tools: ["gh@latest"] }],
              },
            },
          ],
          runtimeClients: [
            {
              clientId: "codex-cli",
              setup: {
                env: {
                  OPENAI_BASE_URL: "https://api.openai.com",
                },
                files: [],
                launchArgs: ["--sandbox", "workspace-write"],
              },
              processes: [
                {
                  processKey: "process_b",
                  command: {
                    args: ["/usr/local/bin/codex", "app-server", "--listen", "ws://127.0.0.1:4746"],
                  },
                  readiness: {
                    type: "tcp",
                    host: "127.0.0.1",
                    port: 4746,
                    timeoutMs: 5_000,
                  },
                  stop: {
                    signal: "sigterm",
                    timeoutMs: 10_000,
                  },
                },
              ],
              endpoints: [
                {
                  endpointKey: "app-server-b",
                  processKey: "process_b",
                  transport: {
                    type: "ws",
                    url: "ws://127.0.0.1:4746",
                  },
                  connectionMode: "dedicated",
                },
              ],
            },
          ],
          workspaceSources: [],
          agentRuntimes: [
            {
              bindingId: "bind_b",
              runtimeId: "github-agent",
              runtimeKey: "github-app-server",
              clientId: "codex-cli",
              endpointKey: "app-server-b",
              ptyLaunch: createPtyLaunch({
                runtimeId: "github-agent",
                displayName: "GitHub Agent",
                command: "github-agent",
              }),
            },
          ],
        },
        {
          egressRoutes: [
            {
              egressRuleId: "egress_rule_a",
              bindingId: "bind_a",
              match: {
                hosts: ["api.openai.com"],
                methods: ["POST"],
                pathPrefixes: ["/v1"],
              },
              upstream: {
                baseUrl: "https://api.openai.com",
              },
              authInjection: {
                type: "bearer",
                target: "authorization",
              },
              credentialResolver: {
                connectionId: "conn_a",
                secretType: "api_key",
              },
            },
          ],
          artifacts: [
            {
              artifactKey: "codex-cli",
              name: "Codex CLI",
              lifecycle: {
                install: [
                  {
                    op: "exec",
                    command: {
                      args: ["sh", "-euc", "install-codex-latest"],
                    },
                  },
                ],
              },
            },
          ],
          runtimeClients: [
            {
              clientId: "codex-cli",
              setup: {
                env: {
                  OPENAI_ORG: "org_abc",
                },
                files: [
                  {
                    fileId: "codex_config",
                    path: "/root/.codex/config.toml",
                    mode: 384,
                    content: 'model = "gpt-5.3-codex"',
                  },
                ],
                launchArgs: ["--model", "gpt-5.3-codex"],
              },
              processes: [
                {
                  processKey: "process_a",
                  command: {
                    args: ["/usr/local/bin/codex", "app-server", "--listen", "ws://127.0.0.1:4747"],
                  },
                  readiness: {
                    type: "tcp",
                    host: "127.0.0.1",
                    port: 4747,
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
                  endpointKey: "app-server-a",
                  processKey: "process_a",
                  transport: {
                    type: "ws",
                    url: "ws://127.0.0.1:4747",
                  },
                  connectionMode: "dedicated",
                },
              ],
            },
          ],
          workspaceSources: [],
          agentRuntimes: [
            {
              bindingId: "bind_a",
              runtimeId: "codex",
              runtimeKey: "codex-app-server",
              clientId: "codex-cli",
              endpointKey: "app-server-a",
              ptyLaunch: createPtyLaunch({
                runtimeId: "codex",
                displayName: "Codex",
                command: "codex",
              }),
            },
          ],
        },
      ],
    });

    expect(plan.egressRoutes[0]?.egressRuleId).toBe("egress_rule_a");
    expect(plan.artifacts.map((artifact) => artifact.artifactKey)).toEqual(["codex-cli", "gh-cli"]);
    expect(plan.artifacts[1]?.env).toEqual({
      A_VAR: "one",
      Z_VAR: "two",
    });

    const runtimeClient = plan.runtimeClients[0];
    expect(runtimeClient?.clientId).toBe("codex-cli");
    expect(runtimeClient?.setup.env).toEqual({
      OPENAI_BASE_URL: "https://api.openai.com",
      OPENAI_ORG: "org_abc",
    });
    expect(runtimeClient?.setup.launchArgs).toEqual([
      "--sandbox",
      "workspace-write",
      "--model",
      "gpt-5.3-codex",
    ]);
    expect(runtimeClient?.processes.map((process) => process.processKey)).toEqual([
      "process_a",
      "process_b",
    ]);
    expect(runtimeClient?.endpoints.map((endpoint) => endpoint.endpointKey)).toEqual([
      "app-server-a",
      "app-server-b",
    ]);
    expect(plan.agentRuntimes).toEqual([
      {
        bindingId: "bind_a",
        runtimeId: "codex",
        runtimeKey: "codex-app-server",
        clientId: "codex-cli",
        endpointKey: "app-server-a",
        ptyLaunch: createPtyLaunch({
          runtimeId: "codex",
          displayName: "Codex",
          command: "codex",
        }),
      },
      {
        bindingId: "bind_b",
        runtimeId: "github-agent",
        runtimeKey: "github-app-server",
        clientId: "codex-cli",
        endpointKey: "app-server-b",
        ptyLaunch: createPtyLaunch({
          runtimeId: "github-agent",
          displayName: "GitHub Agent",
          command: "github-agent",
        }),
      },
    ]);
  });

  it("dedupes equivalent artifacts with the same artifact key", () => {
    const plan = assembleCompiledRuntimePlan({
      sandboxProfileId: "sbp_123",
      version: 1,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      compiledBindingResults: [
        {
          egressRoutes: [],
          artifacts: [
            {
              artifactKey: "gh-cli",
              name: "GitHub CLI",
              env: {
                GH_TOKEN: GitHubCliPlaceholderToken,
              },
              lifecycle: {
                install: [
                  {
                    op: "exec",
                    command: {
                      args: ["sh", "-euc", "install-gh"],
                    },
                  },
                ],
              },
            },
          ],
          runtimeClients: [],
          workspaceSources: [],
          agentRuntimes: [],
        },
        {
          egressRoutes: [],
          artifacts: [
            {
              artifactKey: "gh-cli",
              name: "GitHub CLI",
              env: {
                GH_TOKEN: GitHubCliPlaceholderToken,
              },
              lifecycle: {
                install: [
                  {
                    op: "exec",
                    command: {
                      args: ["sh", "-euc", "install-gh"],
                    },
                  },
                ],
              },
            },
            {
              artifactKey: "jira-cli",
              name: "Jira CLI",
              lifecycle: {
                install: [
                  {
                    op: "exec",
                    command: {
                      args: ["sh", "-euc", "install-jira"],
                    },
                  },
                ],
              },
            },
          ],
          runtimeClients: [],
          workspaceSources: [],
          agentRuntimes: [],
        },
      ],
    });

    expect(plan.artifacts).toHaveLength(2);
    expect(plan.artifacts.map((artifact) => artifact.artifactKey)).toEqual(["gh-cli", "jira-cli"]);
    expect(plan.artifacts[0]?.env).toEqual({
      GH_TOKEN: expect.stringMatching(GitHubCliTokenPattern),
    });
  });

  it("fails on runtime client merge conflicts", () => {
    expect(() =>
      assembleCompiledRuntimePlan({
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        compiledBindingResults: [
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClients: [
              {
                clientId: "codex-cli",
                setup: {
                  env: {
                    OPENAI_BASE_URL: "https://api.openai.com",
                  },
                  files: [],
                },
                processes: [],
                endpoints: [],
              },
            ],
            workspaceSources: [],
            agentRuntimes: [],
          },
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClients: [
              {
                clientId: "codex-cli",
                setup: {
                  env: {
                    OPENAI_BASE_URL: "https://example.invalid/openai-v2",
                  },
                  files: [],
                },
                processes: [],
                endpoints: [],
              },
            ],
            workspaceSources: [],
            agentRuntimes: [],
          },
        ],
      }),
    ).toThrow(IntegrationCompilerError);

    let caughtError: unknown;
    try {
      assembleCompiledRuntimePlan({
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        compiledBindingResults: [
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClients: [
              {
                clientId: "codex-cli",
                setup: {
                  env: {
                    OPENAI_BASE_URL: "https://api.openai.com",
                  },
                  files: [],
                },
                processes: [],
                endpoints: [],
              },
            ],
            workspaceSources: [],
            agentRuntimes: [],
          },
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClients: [
              {
                clientId: "codex-cli",
                setup: {
                  env: {
                    OPENAI_BASE_URL: "https://example.invalid/openai-v2",
                  },
                  files: [],
                },
                processes: [],
                endpoints: [],
              },
            ],
            workspaceSources: [],
            agentRuntimes: [],
          },
        ],
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationCompilerError);
    expect(caughtError).toMatchObject({
      code: CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
    });
  });

  it("fails on runtime client fileId merge conflicts", () => {
    expect(() =>
      assembleCompiledRuntimePlan({
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        compiledBindingResults: [
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClients: [
              {
                clientId: "codex-cli",
                setup: {
                  env: {},
                  files: [
                    {
                      fileId: "codex_config",
                      path: "/root/.codex/config.toml",
                      mode: 384,
                      content: 'model = "gpt-5.3-codex"',
                    },
                  ],
                },
                processes: [],
                endpoints: [],
              },
            ],
            workspaceSources: [],
            agentRuntimes: [],
          },
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClients: [
              {
                clientId: "codex-cli",
                setup: {
                  env: {},
                  files: [
                    {
                      fileId: "codex_config",
                      path: "/root/.codex/override.toml",
                      mode: 384,
                      content: 'model = "gpt-5.3-codex"',
                    },
                  ],
                },
                processes: [],
                endpoints: [],
              },
            ],
            workspaceSources: [],
            agentRuntimes: [],
          },
        ],
      }),
    ).toThrow(IntegrationCompilerError);

    let caughtError: unknown;
    try {
      assembleCompiledRuntimePlan({
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        compiledBindingResults: [
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClients: [
              {
                clientId: "codex-cli",
                setup: {
                  env: {},
                  files: [
                    {
                      fileId: "codex_config",
                      path: "/root/.codex/config.toml",
                      mode: 384,
                      content: 'model = "gpt-5.3-codex"',
                    },
                  ],
                },
                processes: [],
                endpoints: [],
              },
            ],
            workspaceSources: [],
            agentRuntimes: [],
          },
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClients: [
              {
                clientId: "codex-cli",
                setup: {
                  env: {},
                  files: [
                    {
                      fileId: "codex_config",
                      path: "/root/.codex/override.toml",
                      mode: 384,
                      content: 'model = "gpt-5.3-codex"',
                    },
                  ],
                },
                processes: [],
                endpoints: [],
              },
            ],
            workspaceSources: [],
            agentRuntimes: [],
          },
        ],
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationCompilerError);
    expect(caughtError).toMatchObject({
      code: CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
    });
  });

  it("normalizes additional egress headers to lowercase sorted keys", () => {
    const plan = CompiledRuntimePlanSchema.parse({
      sandboxProfileId: "sbp_123",
      version: 7,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      egressRoutes: [
        {
          egressRuleId: "egress_rule_openai",
          bindingId: "bind_openai",
          match: {
            hosts: ["api.openai.com"],
          },
          upstream: {
            baseUrl: "https://api.openai.com",
          },
          authInjection: {
            type: "bearer",
            target: "authorization",
          },
          additionalHeaders: {
            "X-Trace-ID": " trace_123 ",
            " ChatGPT-Account-ID ": " acct_123 ",
          },
          credentialResolver: {
            connectionId: "conn_openai",
            secretType: "oauth2_access_token",
          },
        },
      ],
      artifacts: [],
      workspaceSources: [],
      runtimeClients: [],
      agentRuntimes: [],
    });

    expect(plan.egressRoutes[0]?.additionalHeaders).toEqual({
      "chatgpt-account-id": "acct_123",
      "x-trace-id": "trace_123",
    });
  });

  it("rejects additional egress headers that collapse to the same normalized name", () => {
    expect(() =>
      CompiledRuntimePlanSchema.parse({
        sandboxProfileId: "sbp_123",
        version: 7,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        egressRoutes: [
          {
            egressRuleId: "egress_rule_openai",
            bindingId: "bind_openai",
            match: {
              hosts: ["api.openai.com"],
            },
            upstream: {
              baseUrl: "https://api.openai.com",
            },
            authInjection: {
              type: "bearer",
              target: "authorization",
            },
            additionalHeaders: {
              "ChatGPT-Account-ID": "acct_123",
              "chatgpt-account-id": "acct_456",
            },
            credentialResolver: {
              connectionId: "conn_openai",
              secretType: "oauth2_access_token",
            },
          },
        ],
        artifacts: [],
        workspaceSources: [],
        runtimeClients: [],
        agentRuntimes: [],
      }),
    ).toThrow(/Duplicate additional header/);
  });

  it("normalizes additional credential-backed egress headers to lowercase sorted keys", () => {
    const plan = CompiledRuntimePlanSchema.parse({
      sandboxProfileId: "sbp_123",
      version: 7,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      egressRoutes: [
        {
          egressRuleId: "egress_rule_datadog",
          bindingId: "bind_datadog",
          match: {
            hosts: ["mcp.datadoghq.com"],
          },
          upstream: {
            baseUrl: "https://mcp.datadoghq.com",
          },
          authInjection: {
            type: "header",
            target: "DD_API_KEY",
          },
          additionalCredentialHeaders: [
            {
              header: " DD_APPLICATION_KEY ",
              credentialResolver: {
                connectionId: "conn_datadog",
                secretType: "api_key",
                slotKey: "datadog.datadog-default.api-key.application-key",
              },
            },
          ],
          credentialResolver: {
            connectionId: "conn_datadog",
            secretType: "api_key",
            slotKey: "datadog.datadog-default.api-key.api-key",
          },
        },
      ],
      artifacts: [],
      workspaceSources: [],
      runtimeClients: [],
      agentRuntimes: [],
    });

    expect(plan.egressRoutes[0]?.additionalCredentialHeaders).toEqual([
      {
        header: "dd_application_key",
        credentialResolver: {
          connectionId: "conn_datadog",
          secretType: "api_key",
          slotKey: "datadog.datadog-default.api-key.application-key",
        },
      },
    ]);
  });

  it("rejects additional credential-backed egress headers that collide after normalization", () => {
    expect(() =>
      CompiledRuntimePlanSchema.parse({
        sandboxProfileId: "sbp_123",
        version: 7,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        egressRoutes: [
          {
            egressRuleId: "egress_rule_datadog",
            bindingId: "bind_datadog",
            match: {
              hosts: ["mcp.datadoghq.com"],
            },
            upstream: {
              baseUrl: "https://mcp.datadoghq.com",
            },
            authInjection: {
              type: "header",
              target: "DD_API_KEY",
            },
            additionalCredentialHeaders: [
              {
                header: " DD_APPLICATION_KEY ",
                credentialResolver: {
                  connectionId: "conn_datadog",
                  secretType: "api_key",
                },
              },
              {
                header: "dd_application_key",
                credentialResolver: {
                  connectionId: "conn_datadog",
                  secretType: "api_key",
                },
              },
            ],
            credentialResolver: {
              connectionId: "conn_datadog",
              secretType: "api_key",
            },
          },
        ],
        artifacts: [],
        workspaceSources: [],
        runtimeClients: [],
        agentRuntimes: [],
      }),
    ).toThrow(/Duplicate additional credential-backed header/);
  });

  it("rejects additional credential-backed egress headers for aws sigv4 routes", () => {
    expect(() =>
      CompiledRuntimePlanSchema.parse({
        sandboxProfileId: "sbp_123",
        version: 7,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        egressRoutes: [
          {
            egressRuleId: "egress_rule_aws",
            bindingId: "bind_aws",
            match: {
              hosts: ["sts.amazonaws.com"],
            },
            upstream: {
              baseUrl: "https://sts.amazonaws.com",
            },
            authInjection: {
              type: "aws_sigv4",
              service: "sts",
              region: "us-east-1",
            },
            additionalCredentialHeaders: [
              {
                header: "x-api-key",
                credentialResolver: {
                  connectionId: "conn_aws",
                  secretType: "api_key",
                },
              },
            ],
            credentialResolver: {
              connectionId: "conn_aws",
              secretType: "aws_secret_access_key",
            },
          },
        ],
        artifacts: [],
        workspaceSources: [],
        runtimeClients: [],
        agentRuntimes: [],
      }),
    ).toThrow(/aws_sigv4/);
  });

  it("rejects github release binary assets that omit format in typed artifact steps", () => {
    expect(() =>
      CompiledRuntimePlanSchema.parse({
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        egressRoutes: [],
        artifacts: [
          {
            artifactKey: "slack-cli",
            name: "Slack CLI",
            lifecycle: {
              install: [
                {
                  op: "github_release_install",
                  repository: "mistlehq/tools",
                  release: {
                    kind: "latest",
                  },
                  asset: {
                    kind: "exact",
                    fileName: "slack-linux-amd64",
                  },
                  installPath: "/usr/local/bin/slack",
                },
              ],
            },
          },
        ],
        workspaceSources: [],
        runtimeClients: [],
        agentRuntimes: [],
      }),
    ).toThrow(/format/);
  });
});
