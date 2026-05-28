import { z } from "@hono/zod-openapi";

import { DataPlaneSandboxInstanceStatusSchema } from "../../../sandbox-instances/schemas.js";

export const ApplyRuntimeLifecycleEventParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const ApplyRuntimeLifecycleEventBodySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("bootstrap_detached"),
      ownerLeaseId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("runtime_readiness_reported"),
      ownerLeaseId: z.string().min(1),
      runtimeReady: z.boolean(),
    })
    .strict(),
]);

export const ApplyRuntimeLifecycleEventOkResponseSchema = z
  .object({
    status: z.literal("ok"),
    sandboxInstanceId: z.string().min(1),
    lifecycleStatus: DataPlaneSandboxInstanceStatusSchema,
  })
  .strict();
