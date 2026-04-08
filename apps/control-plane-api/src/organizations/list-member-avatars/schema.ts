import { z } from "@hono/zod-openapi";

export const ListMemberAvatarsParamsSchema = z
  .object({
    organizationId: z.string().min(1),
  })
  .strict();

export const ListMemberAvatarsRequestBodySchema = z
  .object({
    userIds: z.array(z.string().trim().min(1)).max(100),
  })
  .strict();
