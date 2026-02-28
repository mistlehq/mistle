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
  artifactInstallPath: string;
  runtimeClientSetup?: {
    clientId: string;
    env: Record<string, string>;
    files: Array<{ path: string; mode: number; content: string }>;
  };
}): CompiledBindingResult {
  return {
    egressRoutes: [input.route],
    artifacts: [
      {
        artifactId: `${input.route.routeId}_artifact`,
        uri: `https://artifacts.example.com/${input.route.routeId}`,
        sha256: `${input.route.routeId}_sha256`,
        installPath: input.artifactInstallPath,
        executable: true,
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
      artifactInstallPath: "/usr/local/bin/codex",
      runtimeClientSetup: {
        clientId: "codex-cli",
        env: {
          OPENAI_BASE_URL: "https://api.openai.com",
        },
        files: [
          {
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
      artifactInstallPath: "/usr/local/bin/gh",
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
      artifactInstallPath: "/tmp/a",
    });
    const resultB = createCompiledBindingResult({
      route: createRoute({
        routeId: "route_b",
        bindingId: "bind_b",
        hosts: ["api.openai.com"],
        pathPrefixes: ["/v1/responses"],
      }),
      artifactInstallPath: "/tmp/b",
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
      artifactInstallPath: "/tmp/a",
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
      artifactInstallPath: "/tmp/b",
      runtimeClientSetup: {
        clientId: "codex-cli",
        env: {
          OPENAI_BASE_URL: "https://api.openai.com/v2",
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
});
