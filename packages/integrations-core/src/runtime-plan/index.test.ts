import { describe, expect, it } from "vitest";

import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import { assembleCompiledRuntimePlan } from "./index.js";

describe("assembleCompiledRuntimePlan", () => {
  it("merges runtime client setup fragments and produces deterministic ordering", () => {
    const plan = assembleCompiledRuntimePlan({
      sandboxProfileId: "sbp_123",
      version: 7,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
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
          runtimeClientSetups: [
            {
              clientId: "codex-cli",
              env: {
                OPENAI_BASE_URL: {
                  kind: "egress_url",
                  routeId: "route_a",
                },
              },
              files: [],
              launchArgs: ["--sandbox", "workspace-write"],
            },
          ],
          runtimeClientProcesses: [
            {
              processKey: "process_b",
              clientId: "codex-cli",
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
          runtimeClientSetups: [
            {
              clientId: "codex-cli",
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
          ],
          runtimeClientProcesses: [
            {
              processKey: "process_a",
              clientId: "codex-cli",
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
        },
      ],
    });

    expect(plan.egressRoutes[0]?.routeId).toBe("route_a");
    expect(plan.artifacts.map((artifact) => artifact.artifactKey)).toEqual(["codex-cli", "gh-cli"]);
    expect(plan.artifactRemovals).toEqual([]);

    const mergedSetup = plan.runtimeClientSetups[0];
    expect(mergedSetup?.clientId).toBe("codex-cli");
    expect(mergedSetup?.env).toEqual({
      OPENAI_BASE_URL: "http://sandboxd.internal/egress/routes/route_a",
      OPENAI_ORG: "org_abc",
    });
    expect(mergedSetup?.launchArgs).toEqual([
      "--sandbox",
      "workspace-write",
      "--model",
      "gpt-5.3-codex",
    ]);
    expect(plan.runtimeClientProcesses.map((process) => process.processKey)).toEqual([
      "process_a",
      "process_b",
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
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
        },
        compiledBindingResults: [
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClientSetups: [
              {
                clientId: "codex-cli",
                env: {
                  OPENAI_BASE_URL: "https://api.openai.com",
                },
                files: [],
              },
            ],
            runtimeClientProcesses: [],
          },
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClientSetups: [
              {
                clientId: "codex-cli",
                env: {
                  OPENAI_BASE_URL: "https://example.invalid/openai-v2",
                },
                files: [],
              },
            ],
            runtimeClientProcesses: [],
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
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
        },
        compiledBindingResults: [
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClientSetups: [
              {
                clientId: "codex-cli",
                env: {
                  OPENAI_BASE_URL: "https://api.openai.com",
                },
                files: [],
              },
            ],
            runtimeClientProcesses: [],
          },
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClientSetups: [
              {
                clientId: "codex-cli",
                env: {
                  OPENAI_BASE_URL: "https://example.invalid/openai-v2",
                },
                files: [],
              },
            ],
            runtimeClientProcesses: [],
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
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
        },
        compiledBindingResults: [
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClientSetups: [
              {
                clientId: "codex-cli",
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
            ],
            runtimeClientProcesses: [],
          },
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClientSetups: [
              {
                clientId: "codex-cli",
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
            ],
            runtimeClientProcesses: [],
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
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
        },
        compiledBindingResults: [
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClientSetups: [
              {
                clientId: "codex-cli",
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
            ],
            runtimeClientProcesses: [],
          },
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClientSetups: [
              {
                clientId: "codex-cli",
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
            ],
            runtimeClientProcesses: [],
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

  it("fails when runtime client setup references a missing egress route", () => {
    expect(() =>
      assembleCompiledRuntimePlan({
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
        },
        compiledBindingResults: [
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClientSetups: [
              {
                clientId: "codex-cli",
                env: {
                  OPENAI_BASE_URL: {
                    kind: "egress_url",
                    routeId: "route_missing",
                  },
                },
                files: [],
              },
            ],
            runtimeClientProcesses: [],
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
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
        },
        compiledBindingResults: [
          {
            egressRoutes: [],
            artifacts: [],
            runtimeClientSetups: [
              {
                clientId: "codex-cli",
                env: {
                  OPENAI_BASE_URL: {
                    kind: "egress_url",
                    routeId: "route_missing",
                  },
                },
                files: [],
              },
            ],
            runtimeClientProcesses: [],
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.RUNTIME_CLIENT_SETUP_INVALID_REF);
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
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
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
          runtimeClientSetups: [],
          runtimeClientProcesses: [],
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
          runtimeClientSetups: [],
          runtimeClientProcesses: [],
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
