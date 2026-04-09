import { z } from "@hono/zod-openapi";

import { DirectoryFilterSchema } from "../schemas.js";

export const ListDirectoryParamsSchema = z
  .object({
    organizationId: z.string().min(1),
  })
  .strict();

export const ListDirectoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
    filter: DirectoryFilterSchema.default("all"),
    search: z.string().trim().default(""),
  })
  .strict();
