import { describe, expect, it } from "vitest";

import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import type { CompiledBindingResult, EgressCredentialRoute } from "../types/index.js";
import { validateCompiledBindingResults } from "./index.js";

function createRoute(input: {
  routeId: string;
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
    routeId: input.routeId,
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
  artifactCreateCommands?: ReadonlyArray<{
    args: ReadonlyArray<string>;
    env?: Record<string, string>;
    cwd?: string;
    timeoutMs?: number;
  }>;
  artifactResumeCommands?: ReadonlyArray<{
    args: ReadonlyArray<string>;
    env?: Record<string, string>;
    cwd?: string;
    timeoutMs?: number;
  }>;
  runtimeClientSetup?: {
    clientId: string;
    env: Record<string, string | { kind: "egress_url"; routeId: string }>;
    files: Array<{ fileId: string; path: string; mode: number; content: string }>;
  };
}): CompiledBindingResult {
  return {
    egressRoutes: [input.route],
    artifacts: [
      {
        artifactKey: input.artifactKey,
        name: input.artifactName ?? `${input.route.routeId} artifact`,
        lifecycle: {
          onSandboxCreate: input.artifactCreateCommands ?? [
            { args: ["echo", "install", input.route.routeId] },
          ],
          ...(input.artifactResumeCommands === undefined
            ? {}
            : { onSandboxResume: input.artifactResumeCommands }),
        },
      },
    ],
    runtimeClientSetups:
      input.runtimeClientSetup === undefined
        ? []
        : [
            {
              clientId: input.runtimeClientSetup.clientId,
              env: input.runtimeClientSetup.env,
              files: input.runtimeClientSetup.files,
            },
          ],
  };
}

describe("validateCompiledBindingResults", () => {
  it("accepts non-conflicting compiled binding outputs", () => {
    const resultA = createCompiledBindingResult({
      route: createRoute({
        routeId: "route_openai",
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
            path: "/workspace/.codex/config.toml",
            mode: 384,
            content: 'model = "gpt-5.3-codex"',
          },
        ],
      },
    });

    const resultB = createCompiledBindingResult({
      route: createRoute({
        routeId: "route_github",
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
        routeId: "route_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
        pathPrefixes: ["/v1"],
      }),
      artifactKey: "artifact-a",
    });
    const resultB = createCompiledBindingResult({
      route: createRoute({
        routeId: "route_b",
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

  it("fails on runtime client env conflicts", () => {
    const resultA = createCompiledBindingResult({
      route: createRoute({
        routeId: "route_a",
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
        routeId: "route_b",
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
        routeId: "route_a",
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
            path: "/workspace/.codex/config.toml",
            mode: 384,
            content: 'model = "gpt-5.3-codex"',
          },
        ],
      },
    });
    const resultB = createCompiledBindingResult({
      route: createRoute({
        routeId: "route_b",
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
            path: "/workspace/.codex/override.toml",
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

  it("accepts runtime client env refs that are structurally equivalent", () => {
    const resultA = createCompiledBindingResult({
      route: createRoute({
        routeId: "route_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "artifact-a",
      runtimeClientSetup: {
        clientId: "codex-cli",
        env: {
          OPENAI_BASE_URL: {
            kind: "egress_url",
            routeId: "route_a",
          },
        },
        files: [],
      },
    });

    const resultB = createCompiledBindingResult({
      route: createRoute({
        routeId: "route_b",
        bindingId: "bind_b",
        hosts: ["api.github.com"],
      }),
      artifactKey: "artifact-b",
      runtimeClientSetup: {
        clientId: "codex-cli",
        env: {
          OPENAI_BASE_URL: {
            kind: "egress_url",
            routeId: "route_a",
          },
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

  it("fails on artifact key conflicts with different lifecycle specs", () => {
    const resultA = createCompiledBindingResult({
      route: createRoute({
        routeId: "route_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "codex-cli",
      artifactName: "Codex CLI",
      artifactCreateCommands: [{ args: ["mise", "install", "npm:@openai/codex@latest"] }],
    });

    const resultB = createCompiledBindingResult({
      route: createRoute({
        routeId: "route_b",
        bindingId: "bind_b",
        hosts: ["api.github.com"],
      }),
      artifactKey: "codex-cli",
      artifactName: "Codex CLI",
      artifactCreateCommands: [{ args: ["mise", "install", "npm:@openai/codex@0.100.0"] }],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [resultA, resultB],
      }),
    ).toThrowError(IntegrationCompilerError);
  });

  it("fails when an artifact has no create commands", () => {
    const result = createCompiledBindingResult({
      route: createRoute({
        routeId: "route_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "codex-cli",
      artifactCreateCommands: [],
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
        routeId: "route_a",
        bindingId: "bind_a",
        hosts: ["api.openai.com"],
      }),
      artifactKey: "codex-cli",
      artifactCreateCommands: [{ args: [] }],
    });

    expect(() =>
      validateCompiledBindingResults({
        compiledBindingResults: [result],
      }),
    ).toThrowError(IntegrationCompilerError);
  });
});
