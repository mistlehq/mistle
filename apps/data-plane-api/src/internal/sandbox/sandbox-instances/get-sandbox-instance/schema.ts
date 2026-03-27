import { z } from "@hono/zod-openapi";

export const GetSandboxInstanceParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const GetSandboxInstanceQuerySchema = z
  .object({
    organizationId: z.string().min(1),
  })
  .strict();

export const ConventionalSandboxInstanceStatuses = Object.freeze({
  PENDING: "pending",
  STARTING: "starting",
  RUNNING: "running",
  STOPPED: "stopped",
  FAILED: "failed",
});

export const GetSandboxInstanceResponseSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum([
      ConventionalSandboxInstanceStatuses.PENDING,
      ConventionalSandboxInstanceStatuses.STARTING,
      ConventionalSandboxInstanceStatuses.RUNNING,
      ConventionalSandboxInstanceStatuses.STOPPED,
      ConventionalSandboxInstanceStatuses.FAILED,
    ]),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict()
  .nullable();

export type GetSandboxInstanceResponse = z.infer<typeof GetSandboxInstanceResponseSchema>;
