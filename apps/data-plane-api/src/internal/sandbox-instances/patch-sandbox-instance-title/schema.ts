import { z } from "@hono/zod-openapi";

export const PatchSandboxInstanceTitleInputSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
    onlyIfUnset: z.boolean().optional(),
    title: z.string().trim().min(1),
  })
  .strict();

export const PatchSandboxInstanceTitleResponseSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export type PatchSandboxInstanceTitleInput = z.infer<typeof PatchSandboxInstanceTitleInputSchema>;
export type PatchSandboxInstanceTitleResponse = z.infer<
  typeof PatchSandboxInstanceTitleResponseSchema
>;
