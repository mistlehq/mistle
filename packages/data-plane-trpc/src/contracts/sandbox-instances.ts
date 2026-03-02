import { SandboxInstanceSources, SandboxInstanceStarterKinds } from "@mistle/db/data-plane";
import { SandboxImageKind } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflows/data-plane";
import { z } from "zod";

export const DataPlaneSandboxImageKinds = SandboxImageKind;
export const DataPlaneSandboxInstanceStarterKinds = SandboxInstanceStarterKinds;
export const DataPlaneSandboxInstanceSources = SandboxInstanceSources;

export const StartSandboxInstanceImageSchema = z
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
      })
      .strict(),
    credentialResolver: z
      .object({
        connectionId: z.string().min(1),
        secretType: z.string().min(1),
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
        remove: z.array(RuntimeArtifactCommandSchema).optional(),
      })
      .strict(),
  })
  .strict();

const RuntimeClientSetupSchema = z
  .object({
    clientId: z.string().min(1),
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

const CompiledRuntimePlanSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    version: z.number().int().min(1),
    image: CompiledRuntimePlanImageSchema,
    egressRoutes: z.array(EgressCredentialRouteSchema),
    artifacts: z.array(CompiledRuntimeArtifactSpecSchema),
    runtimeClientSetups: z.array(RuntimeClientSetupSchema),
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

export const StartSandboxInstanceInputSchema = z.custom<StartSandboxInstanceWorkflowInput>(
  (value) => StartSandboxInstanceInputValidationSchema.safeParse(value).success,
  {
    message: "Invalid start sandbox instance input.",
  },
);

export const StartSandboxInstanceCompletedResponseSchema = z
  .object({
    status: z.literal("completed"),
    sandboxInstanceId: z.string().min(1),
    providerSandboxId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

export type StartSandboxInstanceInput = StartSandboxInstanceWorkflowInput;
export type StartSandboxInstanceCompletedResponse = z.infer<
  typeof StartSandboxInstanceCompletedResponseSchema
>;

type ContractMatchesWorkflowInput =
  StartSandboxInstanceInput extends StartSandboxInstanceWorkflowInput ? true : never;

const contractMatchesWorkflowInput: ContractMatchesWorkflowInput = true;
void contractMatchesWorkflowInput;
