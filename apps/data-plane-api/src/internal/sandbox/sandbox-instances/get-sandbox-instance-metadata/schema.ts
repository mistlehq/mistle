import { z } from "@hono/zod-openapi";

import { SandboxInstanceMetadataResponseSchema } from "../../../sandbox-instances/schemas.js";

export const GetSandboxInstanceMetadataParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const GetSandboxInstanceMetadataQuerySchema = z
  .object({
    organizationId: z.string().min(1),
  })
  .strict();

export const GetSandboxInstanceMetadataResponseSchema = SandboxInstanceMetadataResponseSchema;

export type GetSandboxInstanceMetadataInput = {
  organizationId: string;
  instanceId: string;
};
export type GetSandboxInstanceMetadataResponse = z.infer<
  typeof GetSandboxInstanceMetadataResponseSchema
>;
