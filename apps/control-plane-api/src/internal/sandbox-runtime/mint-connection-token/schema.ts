import { z } from "@hono/zod-openapi";

export const InternalSandboxRuntimeMintConnectionRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
    actingUserId: z.string().min(1).optional(),
    webhookEventId: z.string().min(1).optional(),
    deliveryTaskId: z.string().min(1).optional(),
    externalDeliveryId: z.string().min(1).optional(),
    triggerRunId: z.string().min(1).optional(),
    conversationId: z.string().min(1).optional(),
  })
  .strict();

export const InternalSandboxRuntimeMintConnectionResponseSchema = z
  .object({
    instanceId: z.string().min(1),
    tokenJti: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();
