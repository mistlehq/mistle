import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  SandboxStartupInstanceVolumeModes,
  SandboxStartupInstanceVolumeStates,
  createSandboxTunnelGatewayWsUrl,
  encodeSandboxStartupInput,
} from "./sandbox-startup-input.js";

const Decoder = new TextDecoder();

const RuntimePlanSchema = z.object({
  sandboxProfileId: z.string().min(1),
  version: z.number().int(),
  image: z.discriminatedUnion("source", [
    z.object({
      source: z.literal("profile-base"),
      imageRef: z.string().min(1),
      sandboxProfileId: z.string().min(1),
      version: z.number().int(),
    }),
    z.object({
      source: z.literal("base"),
      imageRef: z.string().min(1),
    }),
  ]),
  egressRoutes: z.array(
    z.object({
      egressRuleId: z.string().min(1),
      bindingId: z.string().min(1),
      match: z.object({
        hosts: z.array(z.string().min(1)),
        pathPrefixes: z.array(z.string()).optional(),
        methods: z.array(z.string()).optional(),
      }),
      upstream: z.object({
        baseUrl: z.string().min(1),
      }),
      authInjection: z.object({
        type: z.enum(["bearer", "basic", "header", "query"]),
        target: z.string().min(1),
        username: z.string().min(1).optional(),
      }),
      credentialResolver: z.object({
        connectionId: z.string().min(1),
        secretType: z.string().min(1),
        purpose: z.string().min(1).optional(),
        resolverKey: z.string().min(1).optional(),
      }),
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
      runtimeKey: z.string().min(1),
      clientId: z.string().min(1),
      endpointKey: z.string().min(1),
      adapterKey: z.string().min(1),
    }),
  ),
});

const SandboxStartupInputSchema = z.object({
  bootstrapToken: z.string().min(1),
  tunnelExchangeToken: z.string().min(1),
  tunnelGatewayWsUrl: z.string().min(1),
  instanceVolume: z.object({
    mode: z.enum([
      SandboxStartupInstanceVolumeModes.NATIVE,
      SandboxStartupInstanceVolumeModes.STAGED,
    ]),
    state: z.enum([
      SandboxStartupInstanceVolumeStates.NEW,
      SandboxStartupInstanceVolumeStates.EXISTING,
    ]),
  }),
  runtimePlan: RuntimePlanSchema,
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

  it("encodes bootstrap token, tunnel exchange token, tunnel gateway ws url, instance volume, and runtime plan as newline-delimited json", () => {
    const encoded = encodeSandboxStartupInput({
      bootstrapToken: "bootstrap-token-value",
      tunnelExchangeToken: "tunnel-exchange-token-value",
      tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      instanceVolume: {
        mode: SandboxStartupInstanceVolumeModes.NATIVE,
        state: SandboxStartupInstanceVolumeStates.NEW,
      },
      runtimePlan: createRuntimePlan(),
    });

    const encodedText = Decoder.decode(encoded);
    expect(encodedText.endsWith("\n")).toBe(true);

    const decoded = SandboxStartupInputSchema.parse(JSON.parse(encodedText.trimEnd()));
    expect(decoded).toEqual({
      bootstrapToken: "bootstrap-token-value",
      tunnelExchangeToken: "tunnel-exchange-token-value",
      tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      instanceVolume: {
        mode: SandboxStartupInstanceVolumeModes.NATIVE,
        state: SandboxStartupInstanceVolumeStates.NEW,
      },
      runtimePlan: createRuntimePlan(),
    });
  });
});
