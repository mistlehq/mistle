import { z } from "@hono/zod-openapi";

export const InternalDispatchSchedulesResponseSchema = z
  .object({
    status: z.literal("queued"),
    cutoffMinute: z.string().min(1),
    idempotencyKey: z.string().min(1),
  })
  .strict()
  .openapi("InternalDispatchSchedulesResponse");

export type InternalDispatchSchedulesResponse = z.infer<
  typeof InternalDispatchSchedulesResponseSchema
>;
