import { z } from "@hono/zod-openapi";

export const ListInvitationsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
    search: z.string().trim().default(""),
  })
  .strict();
