import { z } from "@hono/zod-openapi";
import { createKeysetPaginationEnvelopeSchema } from "@mistle/http/pagination";

export const DataPlaneSandboxInstanceStatuses = Object.freeze({
  PENDING: "pending",
  STARTING: "starting",
  RUNNING: "running",
  STOPPED: "stopped",
  FAILED: "failed",
});

export const DataPlaneSandboxInstanceStatusSchema = z.enum([
  DataPlaneSandboxInstanceStatuses.PENDING,
  DataPlaneSandboxInstanceStatuses.STARTING,
  DataPlaneSandboxInstanceStatuses.RUNNING,
  DataPlaneSandboxInstanceStatuses.STOPPED,
  DataPlaneSandboxInstanceStatuses.FAILED,
]);

export const SandboxInstanceStartedBySchema = z
  .object({
    kind: z.enum(["user", "system"]),
    id: z.string().min(1),
  })
  .strict();

export const SandboxInstanceSourceSchema = z.enum(["dashboard", "webhook"]);

export const GetSandboxInstanceResponseSchema = z
  .object({
    id: z.string().min(1),
    status: DataPlaneSandboxInstanceStatusSchema,
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict()
  .nullable();

export const SandboxInstanceListItemSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    status: DataPlaneSandboxInstanceStatusSchema,
    startedBy: SandboxInstanceStartedBySchema,
    source: SandboxInstanceSourceSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict();

export const ListSandboxInstancesResponseSchema = createKeysetPaginationEnvelopeSchema(
  SandboxInstanceListItemSchema,
  {
    defaultLimit: 20,
    maxLimit: 100,
  },
);

export type GetSandboxInstanceResponse = z.infer<typeof GetSandboxInstanceResponseSchema>;
export type ListSandboxInstancesResponse = z.infer<typeof ListSandboxInstancesResponseSchema>;
