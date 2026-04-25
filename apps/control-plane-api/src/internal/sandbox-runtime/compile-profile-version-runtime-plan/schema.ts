import { z } from "@hono/zod-openapi";
import { CompiledRuntimePlanSchema } from "@mistle/integrations-core";

export const InternalSandboxRuntimeCompileProfileVersionRuntimePlanRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    profileId: z.string().min(1),
    profileVersion: z.number().int().min(1),
    image: z
      .object({
        imageId: z.string().min(1),
        kind: z.enum(["base", "snapshot"]),
      })
      .strict(),
  })
  .strict();

export const InternalSandboxRuntimeCompileProfileVersionRuntimePlanResponseSchema = z
  .object({
    runtimePlan: CompiledRuntimePlanSchema,
  })
  .strict();
