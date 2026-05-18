import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";
import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";

import { SandboxInstancesNotFoundCodes } from "./constants.js";

const sandboxInstanceStatusSchema = z.enum(["pending", "starting", "running", "stopped", "failed"]);
const sandboxInstanceSourceSchema = z.enum(["dashboard", "webhook", "schedule"]);
const sandboxInstanceStartedBySchema = z
  .object({
    kind: z.enum(["user", "api_key", "system"]),
    id: z.string().min(1),
    name: z.string().min(1).nullable(),
  })
  .strict();

export const sandboxInstanceIdParamsSchema = z
  .object({
    instanceId: z
      .string()
      .min(1)
      .regex(/^sbi_[a-zA-Z0-9_-]+$/, {
        message: "`instanceId` must be a sandbox instance id.",
      }),
  })
  .strict();

export const sandboxInstancePortAccessParamsSchema = sandboxInstanceIdParamsSchema
  .extend({
    port: z.coerce.number().int().min(1).max(65_535),
  })
  .strict();

export const sandboxInstanceConnectionTokenSchema = z
  .object({
    instanceId: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

export const sandboxInstancePortAccessSchema = z
  .object({
    host: z.string().min(1),
    bootstrapPath: z.literal("/_mistle/access/bootstrap"),
    bootstrapUrl: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

export const sandboxInstanceStatusResponseSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).nullable(),
    status: sandboxInstanceStatusSchema,
    connectable: z.boolean(),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    runtimeContext: z
      .object({
        agentRuntimeId: z.enum(["codex", "opencode"]).nullable(),
        launchCwd: z.string().min(1).nullable(),
        primaryRepositoryRoot: z.string().min(1).nullable(),
      })
      .strict()
      .nullable(),
    automationConversation: z
      .object({
        conversationId: z.string().min(1),
        routeId: z.string().min(1).nullable(),
        providerConversationId: z.string().min(1).nullable(),
      })
      .nullable(),
    startupOperation: z
      .object({
        operationId: z.string().min(1),
        operationKind: z.enum(["start", "resume"]),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const sandboxOperationEventsQuerySchema = z
  .object({
    operationId: z.string().min(1),
    afterSequence: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

export const sandboxOperationEventSchema = z
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

export const sandboxOperationEventsResponseSchema = z
  .object({
    events: z.array(sandboxOperationEventSchema),
  })
  .strict();

export const sandboxInstancesNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND),
);

export const redirectLocationHeaderSchema = z
  .object({
    Location: z.string().min(1),
  })
  .strict();

export const sandboxInstanceListItemSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    title: z.string().min(1).nullable(),
    sandboxProfileDisplayName: z.string().min(1).nullable(),
    sandboxProfileVersion: z.number().int().min(1),
    status: sandboxInstanceStatusSchema,
    startedBy: sandboxInstanceStartedBySchema,
    source: sandboxInstanceSourceSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict();

export const listSandboxInstancesQuerySchema = createKeysetPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
})
  .extend({
    search: z.string().trim().min(1).max(200).optional(),
    owner: z.enum(["me"]).optional(),
    startedFrom: z.enum(["manual", "trigger", "event", "schedule"]).optional(),
    triggerId: z.string().min(1).optional(),
  })
  .refine((value) => value.triggerId === undefined || value.startedFrom === "trigger", {
    message: "`triggerId` can only be provided when `startedFrom` is `trigger`.",
  });

export const listSandboxInstancesResponseSchema = createKeysetPaginationEnvelopeSchema(
  sandboxInstanceListItemSchema,
  {
    defaultLimit: 20,
    maxLimit: 100,
  },
);
