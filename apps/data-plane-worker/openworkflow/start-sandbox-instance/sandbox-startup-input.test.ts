import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  SandboxExecutionModes,
  SandboxStartupModes,
  createSandboxTunnelGatewayWsUrl,
  encodeSandboxStartupInput,
} from "./sandbox-startup-input.js";

const Decoder = new TextDecoder();

const RuntimePlanSchema = z.object({
  sandboxProfileId: z.string().min(1),
  version: z.number().int(),
  image: z.object({
    source: z.literal("base"),
    imageRef: z.string().min(1),
  }),
  setupScript: z.string().min(1).optional(),
  egressRoutes: z.array(
    z.object({
      egressRuleId: z.string().min(1),
      bindingId: z.string().min(1),
      familyId: z.string().min(1),
      variantId: z.string().min(1),
      match: z.object({
        hosts: z.array(z.string().min(1)),
        pathPrefixes: z.array(z.string()).optional(),
        methods: z.array(z.string()).optional(),
      }),
      upstream: z.object({
        baseUrl: z.string().min(1),
      }),
      authInjection: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("bearer"),
          target: z.string().min(1),
        }),
        z.object({
          type: z.literal("basic"),
          target: z.string().min(1),
          username: z.string().min(1).optional(),
        }),
        z.object({
          type: z.literal("header"),
          target: z.string().min(1),
        }),
        z.object({
          type: z.literal("query"),
          target: z.string().min(1),
        }),
        z.object({
          type: z.literal("aws_sigv4"),
          service: z.string().min(1),
          region: z.string().min(1),
        }),
      ]),
      credentialResolver: z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("integration_connection"),
          connectionId: z.string().min(1),
          secretType: z.string().min(1),
          slotKey: z.string().min(1).optional(),
          resolverKey: z.string().min(1).optional(),
        }),
        z.object({
          kind: z.literal("linked_principal"),
          providerFamily: z.string().min(1),
          actingUserRequired: z.boolean(),
          resolutionMode: z.enum(["required", "preferred"]),
          credentialKind: z.string().min(1).optional(),
        }),
      ]),
      requestMiddleware: z.array(z.string().min(1)).optional(),
    }),
  ),
  artifacts: z.array(
    z.object({
      artifactKey: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      lifecycle: z.object({
        install: z.array(
          z.object({
            args: z.array(z.string()),
            env: z.record(z.string(), z.string()).optional(),
            cwd: z.string().optional(),
            timeoutMs: z.number().int().optional(),
          }),
        ),
        update: z.array(
          z.object({
            args: z.array(z.string()),
            env: z.record(z.string(), z.string()).optional(),
            cwd: z.string().optional(),
            timeoutMs: z.number().int().optional(),
          }),
        ),
        remove: z.array(
          z.object({
            args: z.array(z.string()),
            env: z.record(z.string(), z.string()).optional(),
            cwd: z.string().optional(),
            timeoutMs: z.number().int().optional(),
          }),
        ),
      }),
    }),
  ),
  workspaceSources: z.array(
    z.discriminatedUnion("sourceKind", [
      z.object({
        sourceKind: z.literal("git-clone"),
        resourceKind: z.literal("repository"),
        path: z.string().min(1),
        originUrl: z.url(),
      }),
    ]),
  ),
  runtimeClients: z.array(
    z.object({
      clientId: z.string().min(1),
      setup: z.object({
        env: z.record(z.string(), z.string()),
        files: z.array(
          z.object({
            fileId: z.string().min(1),
            path: z.string().min(1),
            mode: z.number().int(),
            content: z.string(),
          }),
        ),
        launchArgs: z.array(z.string()).optional(),
      }),
      processes: z.array(
        z.object({
          processKey: z.string().min(1),
          command: z.object({
            args: z.array(z.string()),
            env: z.record(z.string(), z.string()).optional(),
            cwd: z.string().optional(),
            timeoutMs: z.number().int().optional(),
          }),
          readiness: z.discriminatedUnion("type", [
            z.object({
              type: z.literal("none"),
            }),
            z.object({
              type: z.literal("tcp"),
              host: z.string().min(1),
              port: z.number().int().min(1).max(65_535),
              timeoutMs: z.number().int().positive(),
            }),
            z.object({
              type: z.literal("http"),
              url: z.url(),
              expectedStatus: z.number().int().min(100).max(599),
              timeoutMs: z.number().int().positive(),
            }),
            z.object({
              type: z.literal("ws"),
              url: z.url().refine((value) => {
                const parsedURL = new URL(value);
                return parsedURL.protocol === "ws:" || parsedURL.protocol === "wss:";
              }, "URL must use ws or wss scheme"),
              timeoutMs: z.number().int().positive(),
            }),
          ]),
          stop: z.object({
            signal: z.enum(["sigterm", "sigkill"]),
            timeoutMs: z.number().int().positive(),
            gracePeriodMs: z.number().int().min(0).optional(),
          }),
        }),
      ),
      endpoints: z.array(
        z.object({
          endpointKey: z.string().min(1),
          processKey: z.string().min(1).optional(),
          transport: z.object({
            type: z.literal("ws"),
            url: z.url().refine((value) => {
              const parsedURL = new URL(value);
              return parsedURL.protocol === "ws:" || parsedURL.protocol === "wss:";
            }, "URL must use ws or wss scheme"),
          }),
          connectionMode: z.enum(["dedicated", "shared"]),
        }),
      ),
    }),
  ),
  agentRuntimes: z.array(
    z.object({
      bindingId: z.string().min(1),
      runtimeId: z.string().min(1),
      runtimeKey: z.string().min(1),
      clientId: z.string().min(1),
      endpointKey: z.string().min(1),
      ptyLaunch: z.object({
        runtimeId: z.string().min(1),
        displayName: z.string().min(1),
        newLaunch: z.object({
          ptySessionId: z.string().min(1),
          cols: z.int().positive(),
          rows: z.int().positive(),
          cwd: z.string().min(1).optional(),
          command: z.string().min(1),
          args: z.array(
            z.discriminatedUnion("kind", [
              z.object({
                kind: z.literal("literal"),
                value: z.string().min(1),
              }),
              z.object({
                kind: z.literal("threadId"),
              }),
            ]),
          ),
        }),
        resumeLaunch: z.object({
          ptySessionId: z.string().min(1),
          cols: z.int().positive(),
          rows: z.int().positive(),
          cwd: z.string().min(1).optional(),
          command: z.string().min(1),
          args: z.array(
            z.discriminatedUnion("kind", [
              z.object({
                kind: z.literal("literal"),
                value: z.string().min(1),
              }),
              z.object({
                kind: z.literal("threadId"),
              }),
            ]),
          ),
        }),
      }),
    }),
  ),
});

const SandboxStartupInputSchema = z.object({
  startupMode: z.enum([SandboxStartupModes.NEW, SandboxStartupModes.EXISTING]),
  executionMode: z.enum([SandboxExecutionModes.SESSION, SandboxExecutionModes.SNAPSHOT]).optional(),
  operationKind: z.enum(["start", "resume", "setup_check", "snapshot"]),
  bootstrapToken: z.string().min(1),
  tunnelExchangeToken: z.string().min(1),
  tunnelGatewayWsUrl: z.string().min(1),
  runtimePlan: RuntimePlanSchema,
  gitIdentity: z
    .object({
      name: z.string().min(1),
      email: z.email(),
      signing: z
        .object({
          format: z.literal("ssh"),
          program: z.string().min(1),
          keyRef: z.string().min(1),
          organizationId: z.string().min(1),
          providerFamily: z.string().min(1),
          actingUserId: z.string().min(1),
          grant: z.string().min(1),
        })
        .optional(),
    })
    .optional(),
  transparentProxy: z
    .object({
      passthroughBypass: z.object({
        kind: z.literal("socket_mark"),
        mark: z.number().int().positive(),
      }),
      exclusions: z.array(
        z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("cidr"),
            value: z.string().min(1),
            reason: z.string().min(1),
          }),
          z.object({
            kind: z.literal("host"),
            value: z.string().min(1),
            reason: z.string().min(1),
          }),
        ]),
      ),
    })
    .optional(),
});

function createRuntimePlan(): StartSandboxInstanceWorkflowInput["runtimePlan"] {
  return {
    sandboxProfileId: "sbp_runtime_plan_001",
    version: 1,
    image: {
      source: "base",
      imageRef: "registry:3",
    },
    egressRoutes: [
      {
        egressRuleId: "egress_rule_1",
        bindingId: "binding_1",
        familyId: "github",
        variantId: "github-cloud",
        match: {
          hosts: ["api.github.com"],
          pathPrefixes: ["/repos"],
          methods: ["GET"],
        },
        upstream: {
          baseUrl: "https://api.github.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "github_app_installation_token",
          resolverKey: "github_app_installation_token",
        },
      },
    ],
    artifacts: [],
    workspaceSources: [],
    runtimeClients: [],
    agentRuntimes: [],
  };
}

describe("encodeSandboxStartupInput", () => {
  it("appends sandbox instance id to the tunnel gateway ws url path", () => {
    const url = createSandboxTunnelGatewayWsUrl({
      gatewayWebsocketUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      sandboxInstanceId: "sbi_example_001",
    });

    expect(url).toBe("ws://127.0.0.1:5003/tunnel/sandbox/sbi_example_001");
  });

  it("trims a trailing slash before appending sandbox instance id to the tunnel gateway ws url path", () => {
    const url = createSandboxTunnelGatewayWsUrl({
      gatewayWebsocketUrl: "ws://127.0.0.1:5003/tunnel/sandbox/",
      sandboxInstanceId: "sbi_example_001",
    });

    expect(url).toBe("ws://127.0.0.1:5003/tunnel/sandbox/sbi_example_001");
  });

  it("adds the operation id as a tunnel gateway query parameter when present", () => {
    const url = createSandboxTunnelGatewayWsUrl({
      gatewayWebsocketUrl: "ws://127.0.0.1:5003/tunnel/sandbox?x-mistle-test-environment-id=test",
      operationId: "op_start_001",
      sandboxInstanceId: "sbi_example_001",
    });

    expect(url).toBe(
      "ws://127.0.0.1:5003/tunnel/sandbox/sbi_example_001?x-mistle-test-environment-id=test&operation_id=op_start_001",
    );
  });

  it("encodes the startup input as newline-delimited json", () => {
    const encoded = encodeSandboxStartupInput({
      startupMode: SandboxStartupModes.NEW,
      operationKind: "start",
      bootstrapToken: "bootstrap-token-value",
      tunnelExchangeToken: "tunnel-exchange-token-value",
      tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      runtimePlan: createRuntimePlan(),
    });

    const encodedText = Decoder.decode(encoded);
    expect(encodedText.endsWith("\n")).toBe(true);

    const decoded = SandboxStartupInputSchema.parse(JSON.parse(encodedText.trimEnd()));
    expect(decoded).toEqual({
      startupMode: SandboxStartupModes.NEW,
      operationKind: "start",
      bootstrapToken: "bootstrap-token-value",
      tunnelExchangeToken: "tunnel-exchange-token-value",
      tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      runtimePlan: createRuntimePlan(),
    });
  });

  it("encodes optional git identity when present", () => {
    const encoded = encodeSandboxStartupInput({
      startupMode: SandboxStartupModes.NEW,
      operationKind: "start",
      bootstrapToken: "bootstrap-token-value",
      tunnelExchangeToken: "tunnel-exchange-token-value",
      tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      runtimePlan: createRuntimePlan(),
      gitIdentity: {
        name: "Mistle User",
        email: "mistle-user@example.com",
      },
    });

    const decoded = SandboxStartupInputSchema.parse(JSON.parse(Decoder.decode(encoded).trimEnd()));
    expect(decoded.gitIdentity).toEqual({
      name: "Mistle User",
      email: "mistle-user@example.com",
    });
  });

  it("encodes optional snapshot execution mode when present", () => {
    const encoded = encodeSandboxStartupInput({
      startupMode: SandboxStartupModes.NEW,
      executionMode: SandboxExecutionModes.SNAPSHOT,
      operationKind: "snapshot",
      bootstrapToken: "bootstrap-token-value",
      tunnelExchangeToken: "tunnel-exchange-token-value",
      tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      runtimePlan: createRuntimePlan(),
    });

    const decoded = SandboxStartupInputSchema.parse(JSON.parse(Decoder.decode(encoded).trimEnd()));
    expect(decoded.executionMode).toBe(SandboxExecutionModes.SNAPSHOT);
  });

  it("encodes optional git signing config when present", () => {
    const encoded = encodeSandboxStartupInput({
      startupMode: SandboxStartupModes.NEW,
      operationKind: "start",
      bootstrapToken: "bootstrap-token-value",
      tunnelExchangeToken: "tunnel-exchange-token-value",
      tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      runtimePlan: createRuntimePlan(),
      gitIdentity: {
        name: "Mistle User",
        email: "mistle-user@example.com",
        signing: {
          format: "ssh",
          program: "/opt/mistle/bin/mistle-ssh-sign",
          keyRef: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE",
          organizationId: "org_123",
          providerFamily: "github",
          actingUserId: "usr_123",
          grant: "grant-token-value",
        },
      },
    });

    const decoded = SandboxStartupInputSchema.parse(JSON.parse(Decoder.decode(encoded).trimEnd()));
    expect(decoded.gitIdentity).toEqual({
      name: "Mistle User",
      email: "mistle-user@example.com",
      signing: {
        format: "ssh",
        program: "/opt/mistle/bin/mistle-ssh-sign",
        keyRef: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE",
        organizationId: "org_123",
        providerFamily: "github",
        actingUserId: "usr_123",
        grant: "grant-token-value",
      },
    });
  });

  it("encodes optional transparent proxy configuration when present", () => {
    const encoded = encodeSandboxStartupInput({
      startupMode: SandboxStartupModes.NEW,
      operationKind: "start",
      bootstrapToken: "bootstrap-token-value",
      tunnelExchangeToken: "tunnel-exchange-token-value",
      tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      runtimePlan: createRuntimePlan(),
      transparentProxy: {
        passthroughBypass: {
          kind: "socket_mark",
          mark: 38_514,
        },
        exclusions: [
          {
            kind: "cidr",
            value: "169.254.0.0/16",
            reason: "provider metadata traffic must stay direct",
          },
          {
            kind: "host",
            value: "host.docker.internal",
            reason: "Docker host traffic must stay direct",
          },
        ],
      },
    });

    const decoded = SandboxStartupInputSchema.parse(JSON.parse(Decoder.decode(encoded).trimEnd()));
    expect(decoded.transparentProxy).toEqual({
      passthroughBypass: {
        kind: "socket_mark",
        mark: 38_514,
      },
      exclusions: [
        {
          kind: "cidr",
          value: "169.254.0.0/16",
          reason: "provider metadata traffic must stay direct",
        },
        {
          kind: "host",
          value: "host.docker.internal",
          reason: "Docker host traffic must stay direct",
        },
      ],
    });
  });

  it("preserves an optional setup script in the encoded runtime plan", () => {
    const encoded = encodeSandboxStartupInput({
      startupMode: SandboxStartupModes.NEW,
      operationKind: "start",
      bootstrapToken: "bootstrap-token-value",
      tunnelExchangeToken: "tunnel-exchange-token-value",
      tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      runtimePlan: {
        ...createRuntimePlan(),
        setupScript: "printf 'setup script ran\\n'",
      },
    });

    const decoded = SandboxStartupInputSchema.parse(JSON.parse(Decoder.decode(encoded).trimEnd()));
    expect(decoded.runtimePlan.setupScript).toBe("printf 'setup script ran\\n'");
  });

  it("preserves linked-principal credential resolvers in the encoded runtime plan", () => {
    const encoded = encodeSandboxStartupInput({
      startupMode: SandboxStartupModes.NEW,
      operationKind: "start",
      bootstrapToken: "bootstrap-token-value",
      tunnelExchangeToken: "tunnel-exchange-token-value",
      tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      runtimePlan: {
        ...createRuntimePlan(),
        egressRoutes: [
          {
            egressRuleId: "egress_rule_github",
            bindingId: "binding_github",
            familyId: "github",
            variantId: "github-cloud",
            match: {
              hosts: ["api.github.com"],
              methods: ["POST"],
            },
            upstream: {
              baseUrl: "https://api.github.com",
            },
            authInjection: {
              type: "bearer",
              target: "authorization",
            },
            credentialResolver: {
              kind: "linked_principal",
              providerFamily: "github",
              actingUserRequired: true,
              resolutionMode: "required",
              credentialKind: "github_app_user_access_token",
            },
          },
        ],
      },
    });

    const decoded = SandboxStartupInputSchema.parse(JSON.parse(Decoder.decode(encoded).trimEnd()));
    expect(decoded.runtimePlan.egressRoutes[0]?.credentialResolver).toEqual({
      kind: "linked_principal",
      providerFamily: "github",
      actingUserRequired: true,
      resolutionMode: "required",
      credentialKind: "github_app_user_access_token",
    });
  });
});
