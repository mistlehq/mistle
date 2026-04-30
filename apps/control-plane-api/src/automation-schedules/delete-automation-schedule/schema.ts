import { z } from "@hono/zod-openapi";

export const DeleteAutomationScheduleResponseSchema = z
  .object({
    automationId: z.string().min(1),
  })
  .strict();
