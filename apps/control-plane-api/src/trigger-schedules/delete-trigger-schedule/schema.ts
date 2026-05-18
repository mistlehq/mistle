import { z } from "@hono/zod-openapi";

export const DeleteTriggerScheduleResponseSchema = z
  .object({
    triggerId: z.string().min(1),
  })
  .strict();
