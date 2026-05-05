import { z } from "@hono/zod-openapi";

export const RefreshSandboxEgressGrantsParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const RefreshSandboxEgressGrantsBodySchema = z
  .object({
    organizationId: z.string().min(1),
    actingUserId: z.string().min(1).optional(),
  })
  .strict();

export const RefreshSandboxEgressGrantsResponseSchema = z
  .object({
    status: z.literal("ok"),
    sandboxInstanceId: z.string().min(1),
  })
  .strict();

export type RefreshSandboxEgressGrantsInput = z.infer<
  typeof RefreshSandboxEgressGrantsBodySchema
> & {
  instanceId: string;
};

export type RefreshSandboxEgressGrantsResponse = z.infer<
  typeof RefreshSandboxEgressGrantsResponseSchema
>;
