import { describe, expect, it } from "vitest";

import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import type {
  CompileBindingAgentRuntime,
  CompiledBindingResult,
  CompiledWorkspaceSource,
  EgressCredentialRoute,
  RuntimeClientEndpointSpec,
  RuntimeClientProcessSpec,
} from "../types/index.js";
import { validateCompiledBindingResults } from "./index.js";

function createRoute(input: {
  egressRuleId: string;
  bindingId: string;
  hosts: string[];
  pathPrefixes?: string[];
}): EgressCredentialRoute {
  const match: EgressCredentialRoute["match"] = {
    hosts: input.hosts,
  };

  if (input.pathPrefixes !== undefined) {
    match.pathPrefixes = input.pathPrefixes;
  }

  return {
    egressRuleId: input.egressRuleId,
    bindingId: input.bindingId,
    match,
    upstream: {
      baseUrl: "https://example.com",
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      connectionId: "conn_123",
      secretType: "api_key",
    },
  };
}

function createCompiledBindingResult(input: {
  route: EgressCredentialRoute;
  artifactKey: string;
  artifactName?: string;
  artifactEnv?: Readonly<Record<string, string>>;
  artifactInstallCommands?: ReadonlyArray<{
    args: ReadonlyArray<string>;
    env?: Record<string, string>;
    cwd?: string;
    timeoutMs?: number;
  }>;
  artifactUpdateCommands?: ReadonlyArray<{
    args: ReadonlyArray<string>;
    env?: Record<string, string>;
    cwd?: string;
    timeoutMs?: number;
  }>;
  artifactRemoveCommands?: ReadonlyArray<{
    args: ReadonlyArray<string>;
    env?: Record<string, string>;
    cwd?: string;
    timeoutMs?: number;
  }>;
  runtimeClientSetup?: {
    clientId: string;
    env: Record<string, string>;
    files: Array<{ fileId: string; path: string; mode: number; content: string }>;
  };
  runtimeClientProcesses?: ReadonlyArray<RuntimeClientProcessSpec>;
  runtimeClientEndpoints?: ReadonlyArray<RuntimeClientEndpointSpec>;
  workspaceSources?: ReadonlyArray<CompiledWorkspaceSource>;
  agentRuntimes?: ReadonlyArray<CompileBindingAgentRuntime>;
}): CompiledBindingResult {
  const hasRuntimeClient =
    input.runtimeClientSetup !== undefined ||
    (input.runtimeClientProcesses !== undefined && input.runtimeClientProcesses.length > 0) ||
    (input.runtimeClientEndpoints !== undefined && input.runtimeClientEndpoints.length > 0);

  return {
    egressRoutes: [input.route],
    artifacts: [
      {
        artifactKey: input.artifactKey,
        name: input.artifactName ?? `${input.route.egressRuleId} artifact`,
        ...(input.artifactEnv === undefined ? {} : { env: input.artifactEnv }),
        lifecycle: {
          install: input.artifactInstallCommands ?? [
            { args: ["echo", "install", input.route.egressRuleId] },
          ],
          ...(input.artifactUpdateCommands === undefined
            ? {}
            : { update: input.artifactUpdateCommands }),
          remove: input.artifactRemoveCommands ?? [
            { args: ["echo", "remove", input.route.egressRuleId] },
          ],
        },
      },
    ],
    runtimeClients: !hasRuntimeClient
      ? []
      : [
          {
            clientId: input.runtimeClientSetup?.clientId ?? "codex-cli",
            setup: {
              env: input.runtimeClientSetup?.env ?? {},
              files: input.runtimeClientSetup?.files ?? [],
            },
            processes: input.runtimeClientProcesses ?? [],
            endpoints: input.runtimeClientEndpoints ?? [],
          },
        ],
    workspaceSources: input.workspaceSources ?? [],
    agentRuntimes:
      input.agentRuntimes?.map((agentRuntime) => ({
        ...agentRuntime,
        bindingId: input.route.bindingId,
      })) ?? [],
  };
}

describe("validateCompiledBindingResults", () => {
  it("accepts non-conflicting compiled binding outputs", () => {
    const resultA = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_openai",
        bindingId: "bind_openai",
        hosts: ["api.openai.com"],
        pathPrefixes: ["/v1/responses"],
      }),
      artifactKey: "codex-cli",
      runtimeClientSetup: {
        clientId: "codex-cli",
        env: {
          OPENAI_BASE_URL: "https://api.openai.com",
        },
        files: [
          {
            fileId: "codex_config",
            path: "/home/sandbox/.codex/config.toml",
            mode: 384,
            content: 'model = "gpt-5.3-codex"',
          },
        ],
      },
    });

    const resultB = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_github",
        bindingId: "bind_github",
        hosts: ["api.github.com"],
        pathPrefixes: ["/repos"],
      }),
      artifactKey: "gh-cli",
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [resultA, resultB],
      }),
    ).not.toThrow();
  });

  it("fails on overlapping routes", () => {
    const resultA = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
        pathPrefixes: ["/v1"],
      }),
      artifactKey: "artifact-a",
    });
    const resultB = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_b",
        bindingId: "bind_b",
        hosts: ["api.openai.com"],
        pathPrefixes: ["/v1/responses"],
      }),
      artifactKey: "artifact-b",
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [resultA, resultB],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      validateCompiledBindingResults({
        compiledBindingResults: [resultA, resultB],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.ROUTE_CONFLICT);
      }
    }
  });

  it("fails on duplicate workspace source paths", () => {
    const resultA = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["github.com"],
      }),
      artifactKey: "artifact-a",
      workspaceSources: [
        {
          sourceKind: "git-clone",
          resourceKind: "repository",
          path: "/home/sandbox/projects/mistlehq/mistle",
          originUrl: "https://github.com/mistlehq/mistle.git",
        },
      ],
    });
    const resultB = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_b",
        bindingId: "bind_b",
        hosts: ["github.example.com"],
      }),
      artifactKey: "artifact-b",
      workspaceSources: [
        {
          sourceKind: "git-clone",
          resourceKind: "repository",
          path: "/home/sandbox/projects/mistlehq/mistle",
          originUrl: "https://github.example.com/mistlehq/mistle.git",
        },
      ],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [resultA, resultB],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      validateCompiledBindingResults({
        compiledBindingResults: [resultA, resultB],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT);
      }
    }
  });

  it("fails when a route contains an empty path prefix", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
        pathPrefixes: [""],
      }),
      artifactKey: "artifact-a",
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.ROUTE_CONFLICT);
      }
    }
  });

  it("fails on runtime client env conflicts", () => {
    const resultA = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "artifact-a",
      runtimeClientSetup: {
        clientId: "codex-cli",
        env: {
          OPENAI_BASE_URL: "https://api.openai.com",
        },
        files: [],
      },
    });
    const resultB = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_b",
        bindingId: "bind_b",
        hosts: ["api.github.com"],
      }),
      artifactKey: "artifact-b",
      runtimeClientSetup: {
        clientId: "codex-cli",
        env: {
          OPENAI_BASE_URL: "https://example.invalid/openai-v2",
        },
        files: [],
      },
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [resultA, resultB],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      validateCompiledBindingResults({
        compiledBindingResults: [resultA, resultB],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT);
      }
    }
  });

  it("fails on runtime client fileId conflicts", () => {
    const resultA = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "artifact-a",
      runtimeClientSetup: {
        clientId: "codex-cli",
        env: {},
        files: [
          {
            fileId: "codex_config",
            path: "/home/sandbox/.codex/config.toml",
            mode: 384,
            content: 'model = "gpt-5.3-codex"',
          },
        ],
      },
    });
    const resultB = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_b",
        bindingId: "bind_b",
        hosts: ["api.github.com"],
      }),
      artifactKey: "artifact-b",
      runtimeClientSetup: {
        clientId: "codex-cli",
        env: {},
        files: [
          {
            fileId: "codex_config",
            path: "/home/sandbox/.codex/override.toml",
            mode: 384,
            content: 'model = "gpt-5.3-codex"',
          },
        ],
      },
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [resultA, resultB],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      validateCompiledBindingResults({
        compiledBindingResults: [resultA, resultB],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT);
      }
    }
  });

  it("accepts runtime client env values that are structurally equivalent", () => {
    const resultA = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "artifact-a",
      runtimeClientSetup: {
        clientId: "codex-cli",
        env: {
          OPENAI_BASE_URL: "https://api.openai.com",
        },
        files: [],
      },
    });

    const resultB = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_b",
        bindingId: "bind_b",
        hosts: ["api.github.com"],
      }),
      artifactKey: "artifact-b",
      runtimeClientSetup: {
        clientId: "codex-cli",
        env: {
          OPENAI_BASE_URL: "https://api.openai.com",
        },
        files: [],
      },
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [resultA, resultB],
      }),
    ).not.toThrow();
  });

  it("fails on runtime client process key conflicts", () => {
    const processA: RuntimeClientProcessSpec = {
      processKey: "codex-app-server",
      command: {
        args: ["/usr/local/bin/codex", "app-server", "--listen", "ws://127.0.0.1:4500"],
      },
      readiness: {
        type: "tcp",
        host: "127.0.0.1",
        port: 4500,
        timeoutMs: 5_000,
      },
      stop: {
        signal: "sigterm",
        timeoutMs: 10_000,
      },
    };
    const processB: RuntimeClientProcessSpec = {
      processKey: "codex-app-server",
      command: {
        args: ["/usr/local/bin/codex", "app-server", "--listen", "ws://127.0.0.1:4500"],
      },
      readiness: {
        type: "none",
      },
      stop: {
        signal: "sigterm",
        timeoutMs: 10_000,
      },
    };

    const resultA = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "artifact-a",
      runtimeClientProcesses: [processA],
    });
    const resultB = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_b",
        bindingId: "bind_b",
        hosts: ["api.github.com"],
      }),
      artifactKey: "artifact-b",
      runtimeClientProcesses: [processB],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [resultA, resultB],
      }),
    ).toThrowError(IntegrationCompilerError);
  });

  it("fails when runtime client process readiness is invalid", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "artifact-a",
      runtimeClientProcesses: [
        {
          processKey: "codex-app-server",
          command: {
            args: ["/usr/local/bin/codex", "app-server", "--listen", "ws://127.0.0.1:4500"],
          },
          readiness: {
            type: "tcp",
            host: "127.0.0.1",
            port: 0,
            timeoutMs: 5_000,
          },
          stop: {
            signal: "sigterm",
            timeoutMs: 10_000,
          },
        },
      ],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).toThrowError(IntegrationCompilerError);
  });

  it("accepts runtime client process ws readiness", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "artifact-a",
      runtimeClientProcesses: [
        {
          processKey: "codex-app-server",
          command: {
            args: ["/usr/local/bin/codex", "app-server", "--listen", "ws://127.0.0.1:4500"],
          },
          readiness: {
            type: "ws",
            url: "ws://127.0.0.1:4500",
            timeoutMs: 5_000,
          },
          stop: {
            signal: "sigterm",
            timeoutMs: 10_000,
          },
        },
      ],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).not.toThrow();
  });

  it("fails when runtime client process ws readiness uses unsupported url scheme", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "artifact-a",
      runtimeClientProcesses: [
        {
          processKey: "codex-app-server",
          command: {
            args: ["/usr/local/bin/codex", "app-server", "--listen", "ws://127.0.0.1:4500"],
          },
          readiness: {
            type: "ws",
            url: "http://127.0.0.1:4500",
            timeoutMs: 5_000,
          },
          stop: {
            signal: "sigterm",
            timeoutMs: 10_000,
          },
        },
      ],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).toThrowError(IntegrationCompilerError);
  });

  it("fails when runtime client endpoint references missing process", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "artifact-a",
      runtimeClientEndpoints: [
        {
          endpointKey: "app-server",
          processKey: "codex-app-server",
          transport: {
            type: "ws",
            url: "ws://127.0.0.1:4500",
          },
          connectionMode: "dedicated",
        },
      ],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).toThrowError(IntegrationCompilerError);
  });

  it("fails when runtime client endpoint ws url uses unsupported url scheme", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "artifact-a",
      runtimeClientEndpoints: [
        {
          endpointKey: "app-server",
          transport: {
            type: "ws",
            url: "http://127.0.0.1:4500",
          },
          connectionMode: "dedicated",
        },
      ],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).toThrowError(IntegrationCompilerError);
  });

  it("fails on artifact key conflicts with different lifecycle specs", () => {
    const resultA = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "codex-cli",
      artifactName: "Codex CLI",
      artifactInstallCommands: [{ args: ["sh", "-euc", "install-codex-latest"] }],
    });

    const resultB = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_b",
        bindingId: "bind_b",
        hosts: ["api.github.com"],
      }),
      artifactKey: "codex-cli",
      artifactName: "Codex CLI",
      artifactInstallCommands: [{ args: ["sh", "-euc", "install-codex-v0.100.0"] }],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [resultA, resultB],
      }),
    ).toThrowError(IntegrationCompilerError);
  });

  it("fails on artifact key conflicts with different env specs", () => {
    const resultA = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "codex-cli",
      artifactName: "Codex CLI",
      artifactEnv: {
        GH_TOKEN: "dummy-token-a",
      },
    });

    const resultB = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_b",
        bindingId: "bind_b",
        hosts: ["api.github.com"],
      }),
      artifactKey: "codex-cli",
      artifactName: "Codex CLI",
      artifactEnv: {
        GH_TOKEN: "dummy-token-b",
      },
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [resultA, resultB],
      }),
    ).toThrowError(IntegrationCompilerError);
  });

  it("fails when an artifact has no install commands", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "codex-cli",
      artifactInstallCommands: [],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).toThrowError(IntegrationCompilerError);
  });

  it("fails when an artifact has no remove commands", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "codex-cli",
      artifactRemoveCommands: [],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).toThrowError(IntegrationCompilerError);
  });

  it("fails when an artifact command has empty args", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "codex-cli",
      artifactInstallCommands: [{ args: [] }],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).toThrowError(IntegrationCompilerError);
  });

  it("fails when an artifact defines a reserved proxy env key", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "codex-cli",
      artifactEnv: {
        HTTPS_PROXY: "http://127.0.0.1:8090",
      },
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).toThrowError(IntegrationCompilerError);
  });

  it("accepts agent runtimes that reference an existing client endpoint", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "codex-cli",
      runtimeClientSetup: {
        clientId: "codex-cli",
        env: {},
        files: [],
      },
      runtimeClientEndpoints: [
        {
          endpointKey: "app-server",
          transport: {
            type: "ws",
            url: "ws://127.0.0.1:4747",
          },
          connectionMode: "dedicated",
        },
      ],
      agentRuntimes: [
        {
          runtimeKey: "codex-app-server",
          clientId: "codex-cli",
          endpointKey: "app-server",
          adapterKey: "openai-codex",
        },
      ],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).not.toThrow();
  });

  it("fails when an agent runtime references a missing client", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "codex-cli",
      agentRuntimes: [
        {
          runtimeKey: "codex-app-server",
          clientId: "missing-client",
          endpointKey: "app-server",
          adapterKey: "openai-codex",
        },
      ],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.AGENT_RUNTIME_CONFLICT);
      }
    }
  });

  it("fails when an agent runtime references a missing endpoint", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "codex-cli",
      runtimeClientSetup: {
        clientId: "codex-cli",
        env: {},
        files: [],
      },
      runtimeClientEndpoints: [
        {
          endpointKey: "other-endpoint",
          transport: {
            type: "ws",
            url: "ws://127.0.0.1:4747",
          },
          connectionMode: "dedicated",
        },
      ],
      agentRuntimes: [
        {
          runtimeKey: "codex-app-server",
          clientId: "codex-cli",
          endpointKey: "app-server",
          adapterKey: "openai-codex",
        },
      ],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.AGENT_RUNTIME_CONFLICT);
      }
    }
  });

  it("fails when an agent runtime omits adapterKey", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        egressRuleId: "egress_rule_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "codex-cli",
      runtimeClientSetup: {
        clientId: "codex-cli",
        env: {},
        files: [],
      },
      runtimeClientEndpoints: [
        {
          endpointKey: "app-server",
          transport: {
            type: "ws",
            url: "ws://127.0.0.1:4747",
          },
          connectionMode: "dedicated",
        },
      ],
      agentRuntimes: [
        {
          runtimeKey: "codex-app-server",
          clientId: "codex-cli",
          endpointKey: "app-server",
          adapterKey: "",
        },
      ],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).toThrowError(IntegrationCompilerError);
  });
});
