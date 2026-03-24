import { z } from "@hono/zod-openapi";
import { CompiledRuntimePlanSchema } from "@mistle/integrations-core";

export const StartSandboxInstanceInputSchema = z
  .object({
    organizationId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    idempotencyKey: z.string().min(1).max(255).optional(),
    runtimePlan: CompiledRuntimePlanSchema,
    startedBy: z
      .object({
        kind: z.enum(["user", "system"]),
        id: z.string().min(1),
      })
      .strict(),
    source: z.enum(["dashboard", "webhook"]),
    image: z
      .object({
        imageId: z.string().min(1),
        createdAt: z.string().min(1),
      })
      .strict(),
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
