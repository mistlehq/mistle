import { z } from "@hono/zod-openapi";

import { GetSandboxInstanceResponseSchema } from "../schemas.js";

const SandboxInstanceReadablePurposeSchema = z.enum([
  "session",
  "designer",
  "setup_assistant",
  "setup_check",
  "skills_discovery",
]);

export const GetSandboxInstanceInputSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
    allowedPurposes: z.array(SandboxInstanceReadablePurposeSchema).min(1).optional(),
  })
  .strict();

export type GetSandboxInstanceInput = z.infer<typeof GetSandboxInstanceInputSchema>;
export type GetSandboxInstanceResponse = z.infer<typeof GetSandboxInstanceResponseSchema>;
