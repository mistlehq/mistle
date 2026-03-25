import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";
import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";

import { SandboxInstancesNotFoundCodes } from "./constants.js";

const sandboxInstanceStatusSchema = z.enum(["starting", "running", "stopped", "failed"]);
const sandboxInstanceSourceSchema = z.enum(["dashboard", "webhook"]);
const sandboxInstanceStartedBySchema = z
  .object({
    kind: z.enum(["user", "system"]),
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

export const sandboxInstanceConnectionTokenSchema = z
  .object({
    instanceId: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

export const sandboxInstanceStatusResponseSchema = z
  .object({
    id: z.string().min(1),
    status: sandboxInstanceStatusSchema,
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    automationConversation: z
      .object({
        conversationId: z.string().min(1),
        routeId: z.string().min(1).nullable(),
        providerConversationId: z.string().min(1).nullable(),
      })
      .nullable(),
  })
  .strict();

export const sandboxInstancesNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND),
);

export const sandboxInstanceListItemSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
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
});

export const listSandboxInstancesResponseSchema = createKeysetPaginationEnvelopeSchema(
  sandboxInstanceListItemSchema,
  {
    defaultLimit: 20,
    maxLimit: 100,
  },
);
