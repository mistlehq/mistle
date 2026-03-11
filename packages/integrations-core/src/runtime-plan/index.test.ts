import { describe, expect, it } from "vitest";

import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import { assembleCompiledRuntimePlan, CompiledRuntimePlanSchema } from "./index.js";

describe("assembleCompiledRuntimePlan", () => {
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
                    args: ["/workspace/.mistle/bin/codex", "app-server"],
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
              runtimeKey: "codex-app-server",
              clientId: "codex-cli",
              endpointKey: "app-server",
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
              routeId: "route_b",
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
                secretType: "oauth_access_token",
              },
            },
          ],
          artifacts: [
            {
              artifactKey: "gh-cli",
              name: "GitHub CLI",
              lifecycle: {
                install: [{ args: ["mise", "install", "gh@latest"] }],
                remove: [{ args: ["rm", "-f", "/usr/local/bin/gh"] }],
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
              runtimeKey: "github-app-server",
              clientId: "codex-cli",
              endpointKey: "app-server-b",
            },
          ],
        },
        {
          egressRoutes: [
            {
              routeId: "route_a",
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
                install: [{ args: ["sh", "-euc", "install-codex-latest"] }],
                remove: [{ args: ["rm", "-f", "/usr/local/bin/codex"] }],
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
                    path: "/workspace/.codex/config.toml",
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
              runtimeKey: "codex-app-server",
              clientId: "codex-cli",
              endpointKey: "app-server-a",
            },
          ],
        },
      ],
    });

    expect(plan.egressRoutes[0]?.routeId).toBe("route_a");
    expect(plan.artifacts.map((artifact) => artifact.artifactKey)).toEqual(["codex-cli", "gh-cli"]);
    expect(plan.artifactRemovals).toEqual([]);

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
        runtimeKey: "codex-app-server",
        clientId: "codex-cli",
        endpointKey: "app-server-a",
      },
      {
        bindingId: "bind_b",
        runtimeKey: "github-app-server",
        clientId: "codex-cli",
        endpointKey: "app-server-b",
      },
    ]);
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
    ).toThrowError(IntegrationCompilerError);

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
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT);
      }
    }
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
                      path: "/workspace/.codex/config.toml",
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
                      path: "/workspace/.codex/override.toml",
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
    ).toThrowError(IntegrationCompilerError);

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
                      path: "/workspace/.codex/config.toml",
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
                      path: "/workspace/.codex/override.toml",
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
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT);
      }
    }
  });

  it("includes artifact removals from previous compiled bindings when artifact key is absent in current plan", () => {
    const plan = assembleCompiledRuntimePlan({
      sandboxProfileId: "sbp_123",
      version: 4,
      image: {
        source: "snapshot",
        imageRef: "127.0.0.1:5001/mistle/sandbox-snapshots@sha256:test",
        instanceId: "sbi_123",
      },
      compiledBindingResults: [
        {
          egressRoutes: [],
          artifacts: [
            {
              artifactKey: "codex-cli",
              name: "Codex CLI",
              lifecycle: {
                install: [{ args: ["echo", "install-codex"] }],
                remove: [{ args: ["rm", "-f", "/usr/local/bin/codex"] }],
              },
            },
          ],
          runtimeClients: [],
          workspaceSources: [],
          agentRuntimes: [],
        },
      ],
      previousCompiledBindingResults: [
        {
          egressRoutes: [],
          artifacts: [
            {
              artifactKey: "codex-cli",
              name: "Codex CLI",
              lifecycle: {
                install: [{ args: ["echo", "install-codex"] }],
                remove: [{ args: ["rm", "-f", "/usr/local/bin/codex"] }],
              },
            },
            {
              artifactKey: "gh-cli",
              name: "GitHub CLI",
              lifecycle: {
                install: [{ args: ["echo", "install-gh"] }],
                remove: [{ args: ["rm", "-f", "/usr/local/bin/gh"] }],
              },
            },
          ],
          runtimeClients: [],
          workspaceSources: [],
          agentRuntimes: [],
        },
      ],
    });

    expect(plan.artifactRemovals).toEqual([
      {
        artifactKey: "gh-cli",
        commands: [{ args: ["rm", "-f", "/usr/local/bin/gh"] }],
      },
    ]);
  });
});
