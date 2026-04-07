import { z } from "@hono/zod-openapi";

export const patchSandboxInstanceTitleBodySchema = z
  .object({
    title: z.string().trim().min(1),
  })
  .strict();

export const patchSandboxInstanceTitleResponseSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
  })
  .strict();
