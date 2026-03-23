import { z } from "@hono/zod-openapi";

import { ORGANIZATION_ROLES } from "../../auth/services/organization-policy.js";

const organizationRoleSchema = z.enum(ORGANIZATION_ROLES);

const membershipCapabilitiesDataSchema = z
  .object({
    organizationId: z.string().min(1),
    actorRole: organizationRoleSchema,
    invite: z
      .object({
        canExecute: z.boolean(),
        assignableRoles: z.array(organizationRoleSchema),
      })
      .strict(),
    memberRoleUpdate: z
      .object({
        canExecute: z.boolean(),
        roleTransitionMatrix: z.record(organizationRoleSchema, z.array(organizationRoleSchema)),
      })
      .strict(),
  })
  .strict();

export const successResponseSchema = z
  .object({
    ok: z.literal(true),
    data: membershipCapabilitiesDataSchema,
    error: z.null(),
  })
  .strict();

export const errorResponseSchema = z
  .object({
    ok: z.literal(false),
    data: z.null(),
    error: z
      .object({
        code: z.enum(["FORBIDDEN", "NOT_FOUND"]),
        message: z.string().min(1),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const paramsSchema = z
  .object({
    organizationId: z.string().min(1),
  })
  .strict();
