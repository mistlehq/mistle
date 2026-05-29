import { z } from "@hono/zod-openapi";

export const CurrentUserOrganizationSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
    role: z.string().min(1),
    isCurrent: z.boolean(),
  })
  .strict();

export const CurrentUserOrganizationsResponseSchema = z
  .object({
    organizations: z.array(CurrentUserOrganizationSchema),
  })
  .strict();
