import { z } from "@hono/zod-openapi";

import { CleanupSkillsDiscoverySandboxInstanceResponseSchema } from "../../../sandbox-instances/cleanup-skills-discovery-sandbox-instance/schema.js";

export const CleanupSkillsDiscoverySandboxInstanceParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const CleanupSkillsDiscoverySandboxInstanceBodySchema = z
  .object({
    organizationId: z.string().min(1),
    startWorkflowRunId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict();

export { CleanupSkillsDiscoverySandboxInstanceResponseSchema };
