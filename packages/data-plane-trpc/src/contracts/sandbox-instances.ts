import { SandboxImageKind } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflows/data-plane";
import { z } from "zod";

const DataPlaneSandboxImageKinds = SandboxImageKind;
const DataPlaneSandboxInstanceStarterKinds = {
  USER: "user",
  SYSTEM: "system",
} as const;
const DataPlaneSandboxInstanceSources = {
  DASHBOARD: "dashboard",
  WEBHOOK: "webhook",
} as const;
export const DataPlaneSandboxInstanceStatuses = {
  STARTING: "starting",
  RUNNING: "running",
  STOPPED: "stopped",
  FAILED: "failed",
} as const;

const StartSandboxInstanceImageSchema = z
  .object({
    imageId: z.string().min(1),
    kind: z.enum(DataPlaneSandboxImageKinds),
    createdAt: z.string().min(1),
  })
  .strict();

const CompiledRuntimePlanImageSchema = z.union([
  z
    .object({
      source: z.literal("snapshot"),
      imageRef: z.string().min(1),
      instanceId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      source: z.literal("profile-base"),
      imageRef: z.string().min(1),
      sandboxProfileId: z.string().min(1),
      version: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      source: z.literal("base"),
      imageRef: z.string().min(1),
    })
    .strict(),
]);

const EgressCredentialRouteSchema = z
  .object({
    routeId: z.string().min(1),
    bindingId: z.string().min(1),
    match: z
      .object({
        hosts: z.array(z.string().min(1)),
        pathPrefixes: z.array(z.string().min(1)).optional(),
        methods: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    upstream: z
      .object({
        baseUrl: z.string().min(1),
      })
      .strict(),
    authInjection: z
      .object({
        type: z.enum(["bearer", "basic", "header", "query"]),
        target: z.string().min(1),
        username: z.string().min(1).optional(),
      })
      .strict(),
    credentialResolver: z
      .object({
        connectionId: z.string().min(1),
        secretType: z.string().min(1),
        purpose: z.string().min(1).optional(),
        resolverKey: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

const RuntimeArtifactCommandSchema = z
  .object({
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

const CompiledRuntimeArtifactSpecSchema = z
  .object({
    artifactKey: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    lifecycle: z
      .object({
        install: z.array(RuntimeArtifactCommandSchema),
        update: z.array(RuntimeArtifactCommandSchema).optional(),
        remove: z.array(RuntimeArtifactCommandSchema),
      })
      .strict(),
  })
  .strict();

const CompiledRuntimeArtifactRemovalSpecSchema = z
  .object({
    artifactKey: z.string().min(1),
    commands: z.array(RuntimeArtifactCommandSchema),
  })
  .strict();

const RuntimeClientSetupSchema = z
  .object({
    env: z.record(z.string(), z.string()),
    files: z.array(
      z
        .object({
          fileId: z.string().min(1),
          path: z.string().min(1),
          mode: z.number().int().min(0),
          content: z.string(),
        })
        .strict(),
    ),
    launchArgs: z.array(z.string()).optional(),
  })
  .strict();

const RuntimeClientProcessReadinessSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("none"),
    })
    .strict(),
  z
    .object({
      type: z.literal("tcp"),
      host: z.string().min(1),
      port: z.number().int().min(1).max(65_535),
      timeoutMs: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("http"),
      url: z.url(),
      expectedStatus: z.number().int().min(100).max(599),
      timeoutMs: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("ws"),
      url: z.url().refine((value) => {
        const parsedURL = new URL(value);
        return parsedURL.protocol === "ws:" || parsedURL.protocol === "wss:";
      }, "URL must use ws or wss scheme"),
      timeoutMs: z.number().int().positive(),
    })
    .strict(),
]);

const RuntimeClientProcessStopPolicySchema = z
  .object({
    signal: z.enum(["sigterm", "sigkill"]),
    timeoutMs: z.number().int().positive(),
    gracePeriodMs: z.number().int().min(0).optional(),
  })
  .strict();

const RuntimeClientProcessSchema = z
  .object({
    processKey: z.string().min(1),
    command: RuntimeArtifactCommandSchema,
    readiness: RuntimeClientProcessReadinessSchema,
    stop: RuntimeClientProcessStopPolicySchema,
  })
  .strict();

const RuntimeClientEndpointTransportSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("ws"),
      url: z.url().refine((value) => {
        const parsedURL = new URL(value);
        return parsedURL.protocol === "ws:" || parsedURL.protocol === "wss:";
      }, "URL must use ws or wss scheme"),
    })
    .strict(),
]);

const RuntimeClientEndpointSchema = z
  .object({
    endpointKey: z.string().min(1),
    processKey: z.string().min(1).optional(),
    transport: RuntimeClientEndpointTransportSchema,
    connectionMode: z.enum(["dedicated", "shared"]),
  })
  .strict();

const RuntimeClientSchema = z
  .object({
    clientId: z.string().min(1),
    setup: RuntimeClientSetupSchema,
    processes: z.array(RuntimeClientProcessSchema),
    endpoints: z.array(RuntimeClientEndpointSchema),
  })
  .strict();

const WorkspaceSourceSchema = z.discriminatedUnion("sourceKind", [
  z
    .object({
      sourceKind: z.literal("git-clone"),
      resourceKind: z.literal("repository"),
      path: z.string().min(1),
      originUrl: z.url(),
      routeId: z.string().min(1),
    })
    .strict(),
]);

const CompiledRuntimePlanSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    version: z.number().int().min(1),
    image: CompiledRuntimePlanImageSchema,
    egressRoutes: z.array(EgressCredentialRouteSchema),
    artifacts: z.array(CompiledRuntimeArtifactSpecSchema),
    artifactRemovals: z.array(CompiledRuntimeArtifactRemovalSpecSchema),
    workspaceSources: z.array(WorkspaceSourceSchema),
    runtimeClients: z.array(RuntimeClientSchema),
  })
  .strict();

const StartSandboxInstanceInputValidationSchema = z
  .object({
    organizationId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    runtimePlan: CompiledRuntimePlanSchema,
    startedBy: z
      .object({
        kind: z.enum(DataPlaneSandboxInstanceStarterKinds),
        id: z.string().min(1),
      })
      .strict(),
    source: z.enum(DataPlaneSandboxInstanceSources),
    image: StartSandboxInstanceImageSchema,
  })
  .strict();

export const StartSandboxInstanceInputSchema = z.custom<StartSandboxInstanceInput>(
  (value) => StartSandboxInstanceInputValidationSchema.safeParse(value).success,
  {
    message: "Invalid start sandbox instance input.",
  },
);

export const StartSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

export const GetSandboxInstanceInputSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
  })
  .strict();

export const GetSandboxInstanceResponseSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(DataPlaneSandboxInstanceStatuses),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict()
  .nullable();

export type StartSandboxInstanceInput = Omit<
  StartSandboxInstanceWorkflowInput,
  "sandboxInstanceId"
>;
export type StartSandboxInstanceAcceptedResponse = z.infer<
  typeof StartSandboxInstanceAcceptedResponseSchema
>;
export type GetSandboxInstanceInput = z.infer<typeof GetSandboxInstanceInputSchema>;
export type GetSandboxInstanceResponse = z.infer<typeof GetSandboxInstanceResponseSchema>;
