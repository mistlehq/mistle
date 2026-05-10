import { z } from "@hono/zod-openapi";
import { CompiledRuntimePlanSchema } from "@mistle/integrations-core";

export const SandboxRuntimeProviderInputSchema = z
  .object({
    provider: z.enum(["docker", "e2b"]),
    connectionId: z.string().min(1).optional(),
    resources: z
      .object({
        vcpuCount: z.number().int().min(1),
        memoryMb: z.number().int().min(1),
        storageMb: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const StartSandboxInstanceInputSchema = z
  .object({
    organizationId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    persistenceMode: z.enum(["ephemeral", "persistent"]),
    purpose: z.enum(["session", "snapshot", "setup_check"]),
    idempotencyKey: z.string().min(1).max(255).optional(),
    runtimePlan: CompiledRuntimePlanSchema,
    startedBy: z
      .object({
        kind: z.enum(["user", "system"]),
        id: z.string().min(1),
      })
      .strict(),
    actingUserId: z.string().min(1).optional(),
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
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    source: z.enum(["dashboard", "webhook", "schedule", "system"]),
    image: z
      .object({
        imageId: z.string().min(1),
        createdAt: z.string().min(1).optional(),
        kind: z.enum(["base", "snapshot"]),
        provider: z.enum(["docker", "e2b"]),
      })
      .strict(),
    sandboxRuntime: SandboxRuntimeProviderInputSchema,
  })
  .strict();

export const StartSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

export type StartSandboxInstanceInput = z.infer<typeof StartSandboxInstanceInputSchema>;
export type StartSandboxInstanceAcceptedResponse = z.infer<
  typeof StartSandboxInstanceAcceptedResponseSchema
>;
