import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import { IntegrationRegistry } from "../registry/index.js";
import type { IntegrationDefinition } from "../types/index.js";
import { compileRuntimePlan } from "./index.js";

const OpenAiTargetConfigSchema = z.object({
  apiBaseUrl: z.url(),
});

const OpenAiBindingConfigSchema = z.object({
  defaultModel: z.string().min(1),
});

function createOpenAiDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof OpenAiBindingConfigSchema
> {
  return {
    familyId: "openai",
    variantId: "openai-default",
    kind: "agent",
    displayName: "OpenAI",
    logoKey: "openai",
    targetConfigSchema: OpenAiTargetConfigSchema,
    bindingConfigSchema: OpenAiBindingConfigSchema,
    supportedAuthSchemes: ["api-key"],
    triggerEventTypes: [],
    userConfigSlots: [],
    compileBinding: (input) => ({
      egressRoutes: [
        {
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
            OPENAI_BASE_URL: input.refs.egressUrl,
            OPENAI_MODEL: input.binding.config.defaultModel,
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
          targetKey: "openai_default",
          target: {
            familyId: "openai",
            variantId: "openai-default",
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
    expect(runtimePlan.egressRoutes[0]).toMatchObject({
      routeId: "route_bind_openai_agent",
      bindingId: "bind_openai_agent",
    });
    expect(runtimePlan.artifacts).toHaveLength(1);
    expect(runtimePlan.runtimeClientSetups).toHaveLength(1);
    expect(runtimePlan.runtimeClientSetups[0]?.env.OPENAI_BASE_URL).toBe(
      "http://127.0.0.1:8090/egress/routes/route_bind_openai_agent",
    );
  });

  it("fails when target is disabled", () => {
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
            targetKey: "openai_default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
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
            targetKey: "openai_default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
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
        expect(error.code).toBe(CompilerErrorCodes.TARGET_DISABLED);
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
            targetKey: "openai_default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
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
            targetKey: "openai_default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
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

  it("fails when target config does not satisfy schema", () => {
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
            targetKey: "openai_default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
              enabled: true,
              config: {
                apiBaseUrl: "not-a-url",
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
            targetKey: "openai_default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
              enabled: true,
              config: {
                apiBaseUrl: "not-a-url",
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
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.INVALID_TARGET_CONFIG);
      }
    }
  });

  it("fails when binding config does not satisfy schema", () => {
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
            targetKey: "openai_default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
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
                defaultModel: "",
              },
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
            targetKey: "openai_default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
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
                defaultModel: "",
              },
            },
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.INVALID_BINDING_CONFIG);
      }
    }
  });

  it("passes parsed schema outputs into compileBinding", () => {
    const targetConfigSchema = z
      .object({
        apiBaseUrl: z.url(),
      })
      .transform((config) => ({
        apiHost: new URL(config.apiBaseUrl).host,
      }));
    const bindingConfigSchema = z
      .object({
        defaultModel: z.string().min(1),
      })
      .transform((config) => ({
        normalizedModel: config.defaultModel.trim().toLowerCase(),
      }));

    const definition: IntegrationDefinition<typeof targetConfigSchema, typeof bindingConfigSchema> =
      {
        familyId: "openai",
        variantId: "openai-default",
        kind: "agent",
        displayName: "OpenAI",
        logoKey: "openai",
        targetConfigSchema,
        bindingConfigSchema,
        supportedAuthSchemes: ["api-key"],
        triggerEventTypes: [],
        userConfigSlots: [],
        compileBinding: (input) => ({
          egressRoutes: [],
          artifacts: [],
          runtimeClientSetups: [
            {
              clientId: "typed-config",
              env: {
                API_HOST: input.target.config.apiHost,
                MODEL: input.binding.config.normalizedModel,
                ROUTE_ID: input.refs.egressUrl.routeId,
              },
              files: [],
            },
          ],
        }),
      };

    const registry = new IntegrationRegistry();
    registry.register(definition);

    const runtimePlan = compileRuntimePlan({
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
          targetKey: "openai_default",
          target: {
            familyId: "openai",
            variantId: "openai-default",
            enabled: true,
            config: {
              apiBaseUrl: "https://api.openai.com/v1",
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
              defaultModel: " GPT-5.3-CODEX ",
            },
          },
        },
      ],
    });

    expect(runtimePlan.runtimeClientSetups).toEqual([
      {
        clientId: "typed-config",
        env: {
          API_HOST: "api.openai.com",
          MODEL: "gpt-5.3-codex",
          ROUTE_ID: "route_bind_openai_agent",
        },
        files: [],
      },
    ]);
  });
});
