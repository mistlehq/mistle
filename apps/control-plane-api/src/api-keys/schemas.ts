import { z } from "@hono/zod-openapi";

import { isOrganizationPermission } from "../auth/services/organization-policy.js";

export const ApiKeyPermissionSchema = z
  .string()
  .min(1)
  .refine(isOrganizationPermission, "Permission is not recognized.");

export const ApiKeySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    secretPrefix: z.string().min(1),
    permissions: z.array(ApiKeyPermissionSchema),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    lastUsedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const ApiKeyIdParamsSchema = z
  .object({
    apiKeyId: z.string().min(1),
  })
  .strict();
