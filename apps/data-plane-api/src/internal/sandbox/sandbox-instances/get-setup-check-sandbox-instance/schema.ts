import { z } from "@hono/zod-openapi";

import { DataPlaneSandboxInstanceStatusSchema } from "../../../sandbox-instances/schemas.js";

export const GetSetupCheckSandboxInstanceParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const GetSetupCheckSandboxInstanceQuerySchema = z
  .object({
    organizationId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.coerce.number().int().min(1),
  })
  .strict();

export const GetSetupCheckSandboxInstanceResponseSchema = z
  .object({
    id: z.string().min(1),
    status: DataPlaneSandboxInstanceStatusSchema,
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    startedAt: z.string().min(1).nullable(),
    stoppedAt: z.string().min(1).nullable(),
    failedAt: z.string().min(1).nullable(),
  })
  .strict()
  .nullable();

export type GetSetupCheckSandboxInstanceResponse = z.infer<
  typeof GetSetupCheckSandboxInstanceResponseSchema
>;
