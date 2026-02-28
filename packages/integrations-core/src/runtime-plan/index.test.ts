import { describe, expect, it } from "vitest";

import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import { assembleCompiledRuntimePlan } from "./index.js";

describe("assembleCompiledRuntimePlan", () => {
  it("merges runtime client setup fragments and produces deterministic ordering", () => {
    const plan = assembleCompiledRuntimePlan({
      sandboxProfileId: "sbp_123",
      version: 7,
      image: {
        source: "default-base",
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
              artifactId: "gh",
              uri: "https://artifacts.example.com/gh",
              sha256: "sha256_gh",
              installPath: "/usr/local/bin/gh",
              executable: true,
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
              artifactId: "codex",
              uri: "https://artifacts.example.com/codex",
              sha256: "sha256_codex",
              installPath: "/usr/local/bin/codex",
              executable: true,
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
        },
      ],
    });

    expect(plan.egressRoutes[0]?.routeId).toBe("route_a");
    expect(plan.artifacts.map((artifact) => artifact.installPath)).toEqual([
      "/usr/local/bin/codex",
      "/usr/local/bin/gh",
    ]);

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
  });

  it("fails on runtime client merge conflicts", () => {
    expect(() =>
      assembleCompiledRuntimePlan({
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "default-base",
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
          },
        ],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      assembleCompiledRuntimePlan({
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "default-base",
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
          source: "default-base",
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
          },
        ],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      assembleCompiledRuntimePlan({
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "default-base",
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
          source: "default-base",
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
          },
        ],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      assembleCompiledRuntimePlan({
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "default-base",
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
});
