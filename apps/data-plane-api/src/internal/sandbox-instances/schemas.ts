import { z } from "@hono/zod-openapi";
import { createKeysetPaginationEnvelopeSchema } from "@mistle/http/pagination";
import { CompiledRuntimePlanSchema } from "@mistle/integrations-core";

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

export const SandboxInstanceSourceSchema = z.enum(["dashboard", "webhook", "schedule", "system"]);

export const GetSandboxInstanceResponseSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).nullable(),
    status: DataPlaneSandboxInstanceStatusSchema,
    connectable: z.boolean(),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    runtimePlan: CompiledRuntimePlanSchema.nullable(),
    startupOperation: z
      .object({
        operationId: z.string().min(1),
        operationKind: z.enum(["start", "resume"]),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .nullable();

export const SandboxInstanceListItemSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    title: z.string().min(1).nullable(),
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

export const SandboxOperationEventSchema = z
  .object({
    id: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
    operationKind: z.enum(["start", "resume", "setup_check", "snapshot", "stop"]),
    operationId: z.string().min(1),
    sequence: z.number().int().min(0),
    recordKind: z.enum(["lifecycle", "transcript"]),
    observedAt: z.string().min(1),
    source: z.enum(["worker", "gateway", "sandboxd"]),
    phase: z
      .enum([
        "provider",
        "storage_provision",
        "storage_attach",
        "sandboxd",
        "operation_stream",
        "git_identity",
        "egress",
        "runtime_plan",
        "setup_script",
        "runtime_processes",
        "runtime_adapters",
        "agent_endpoint",
        "ready",
        "running",
        "snapshot",
        "stop",
        "teardown",
      ])
      .nullable(),
    status: z.enum(["started", "completed", "failed", "warning"]).nullable(),
    stream: z.enum(["stdout", "stderr", "system"]).nullable(),
    message: z.string(),
    payloadBase64: z.string().nullable(),
    attributes: z.record(z.string(), z.unknown()),
    createdAt: z.string().min(1),
  })
  .strict();

export const SandboxOperationEventsResponseSchema = z
  .object({
    events: z.array(SandboxOperationEventSchema),
  })
  .strict();

export type GetSandboxInstanceResponse = z.infer<typeof GetSandboxInstanceResponseSchema>;
export type ListSandboxInstancesResponse = z.infer<typeof ListSandboxInstancesResponseSchema>;
export type SandboxOperationEventsResponse = z.infer<typeof SandboxOperationEventsResponseSchema>;
