import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflows/data-plane";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { encodeSandboxStartupInput } from "./sandbox-startup-input.js";

const Decoder = new TextDecoder();

const RuntimePlanSchema = z.object({
  sandboxProfileId: z.string().min(1),
  version: z.number().int(),
  image: z.discriminatedUnion("source", [
    z.object({
      source: z.literal("snapshot"),
      imageRef: z.string().min(1),
      instanceId: z.string().min(1),
    }),
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
      routeId: z.string().min(1),
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
  artifactRemovals: z.array(
    z.object({
      artifactKey: z.string().min(1),
      commands: z.array(
        z.object({
          args: z.array(z.string()),
          env: z.record(z.string(), z.string()).optional(),
          cwd: z.string().optional(),
          timeoutMs: z.number().int().optional(),
        }),
      ),
    }),
  ),
  runtimeClientSetups: z.array(
    z.object({
      clientId: z.string().min(1),
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
  ),
  runtimeClientProcesses: z.array(
    z.object({
      processKey: z.string().min(1),
      clientId: z.string().min(1),
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
      ]),
      stop: z.object({
        signal: z.enum(["sigterm", "sigkill"]),
        timeoutMs: z.number().int().positive(),
        gracePeriodMs: z.number().int().min(0).optional(),
      }),
    }),
  ),
});

const SandboxStartupInputSchema = z.object({
  bootstrapToken: z.string().min(1),
  tunnelGatewayWsUrl: z.string().min(1),
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
        routeId: "route_1",
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
          secretType: "oauth_access_token",
          purpose: "github_app_installation_token",
          resolverKey: "github_installation_token",
        },
      },
    ],
    artifacts: [],
    artifactRemovals: [],
    runtimeClientSetups: [],
    runtimeClientProcesses: [],
  };
}

describe("encodeSandboxStartupInput", () => {
  it("encodes bootstrap token, tunnel gateway ws url, and runtime plan as newline-delimited json", () => {
    const encoded = encodeSandboxStartupInput({
      bootstrapToken: "bootstrap-token-value",
      tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      runtimePlan: createRuntimePlan(),
    });

    const encodedText = Decoder.decode(encoded);
    expect(encodedText.endsWith("\n")).toBe(true);

    const decoded = SandboxStartupInputSchema.parse(JSON.parse(encodedText.trimEnd()));
    expect(decoded).toEqual({
      bootstrapToken: "bootstrap-token-value",
      tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      runtimePlan: createRuntimePlan(),
    });
  });
});
