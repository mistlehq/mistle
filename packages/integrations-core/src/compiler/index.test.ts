import { describe, expect, it } from "vitest";

import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import { IntegrationRegistry } from "../registry/index.js";
import type { IntegrationDefinition } from "../types/index.js";
import { compileRuntimePlan } from "./index.js";

function createOpenAiDefinition(): IntegrationDefinition {
  return {
    familyId: "openai",
    variantId: "openai_default",
    kind: "agent",
    displayName: "OpenAI",
    logoKey: "openai",
    deploymentConfigSchema: {},
    bindingConfigSchema: {},
    supportedAuthSchemes: ["api-key"],
    triggerEventTypes: [],
    compileBinding: (input) => ({
      egressRoutes: [
        {
          routeId: `route_${input.binding.id}`,
          bindingId: input.binding.id,
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
            connectionId: input.connection.id,
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
      ],
    }),
  };
}

describe("compileRuntimePlan", () => {
  it("compiles bindings into a deterministic runtime plan", () => {
    const registry = new IntegrationRegistry();
    registry.register(createOpenAiDefinition());

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 12,
      image: {
        source: "default-base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      runtimeContext: {
        sandboxProvider: "docker",
        sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
      },
      registry,
      bindings: [
        {
          deploymentKey: "openai_default",
          deployment: {
            familyId: "openai",
            variantId: "openai_default",
            enabled: true,
            config: {
              apiBaseUrl: "https://api.openai.com",
            },
          },
          connection: {
            id: "conn_openai_org_123",
            status: "active",
            config: {},
          },
          binding: {
            id: "bind_openai_agent",
            kind: "agent",
            connectionId: "conn_openai_org_123",
            config: {
              defaultModel: "gpt-5.3-codex",
            },
          },
        },
      ],
    });

    expect(runtimePlan.sandboxProfileId).toBe("sbp_123");
    expect(runtimePlan.version).toBe(12);
    expect(runtimePlan.egressRoutes).toHaveLength(1);
    expect(runtimePlan.artifacts).toHaveLength(1);
    expect(runtimePlan.runtimeClientSetups).toHaveLength(1);
  });

  it("fails when deployment is disabled", () => {
    const registry = new IntegrationRegistry();
    registry.register(createOpenAiDefinition());

    expect(() =>
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "default-base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxProvider: "docker",
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            deploymentKey: "openai_default",
            deployment: {
              familyId: "openai",
              variantId: "openai_default",
              enabled: false,
              config: {},
            },
            connection: {
              id: "conn_openai_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {},
            },
          },
        ],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "default-base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxProvider: "docker",
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            deploymentKey: "openai_default",
            deployment: {
              familyId: "openai",
              variantId: "openai_default",
              enabled: false,
              config: {},
            },
            connection: {
              id: "conn_openai_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {},
            },
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.DEPLOYMENT_DISABLED);
      }
    }
  });

  it("fails when resolved connection does not match binding connectionId", () => {
    const registry = new IntegrationRegistry();
    registry.register(createOpenAiDefinition());

    expect(() =>
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "default-base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxProvider: "docker",
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            deploymentKey: "openai_default",
            deployment: {
              familyId: "openai",
              variantId: "openai_default",
              enabled: true,
              config: {},
            },
            connection: {
              id: "conn_openai_org_999",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {},
            },
          },
        ],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "default-base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxProvider: "docker",
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            deploymentKey: "openai_default",
            deployment: {
              familyId: "openai",
              variantId: "openai_default",
              enabled: true,
              config: {},
            },
            connection: {
              id: "conn_openai_org_999",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {},
            },
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.CONNECTION_MISMATCH);
      }
    }
  });
});
